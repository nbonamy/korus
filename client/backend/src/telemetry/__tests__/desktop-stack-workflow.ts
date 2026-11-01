import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { backendMethods } from "@workspace/core/backend-protocol/methods";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { UsageLedger } from "../../usage/usage-ledger";
import { UsageService } from "../../usage/usage-service";
import { openTelemetryConsent } from "./settings-fixture";
import { RuntimeScheduler } from "../../scheduling/runtime-scheduler";
import { TelemetryUploadService } from "../upload-service";

// Real desktop-owned RPC → private profile/SQLite → sole uploader → local HTTP
// fault receiver → real collector/Postgres. Time, lifecycle and provider
// observations are scripted; this does not launch native windows/providers.
// Risks: accidental opt-in/backfill, duplicate windows/senders, reserialization,
// lost-ACK inflation, restart replay, reset replay and sensitive dimensions.
export async function desktopStackWorkflow(endpoint: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-profile-"));
  const previousHome = process.env.APP_HOME;
  process.env.APP_HOME = dir;
  const DAY = 86400000;
  const today = Math.floor(Date.now() / DAY) * DAY;
  let clock = today - 4 * DAY + 3600000;
  let uploader: TelemetryUploadService | undefined;
  let scheduler: RuntimeScheduler | undefined;
  let loseAck = true;
  const attempts: { body: string; upstream: number; acknowledged: boolean }[] =
    [];
  const transportUrls: string[] = [];
  const receiver = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/telemetry/daily");
      for (const header of ["authorization", "cookie", "x-api-key"])
        assert.equal(req.headers[header], undefined);
      const upstream = await new Promise<number>((resolve, reject) => {
        const forwarded = request(
          endpoint,
          {
            method: "POST",
            headers: {
              Host: "api.invalid",
              "Content-Type": "application/json",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode!));
          },
        );
        forwarded.on("error", reject);
        forwarded.end(body);
      });
      attempts.push({
        body,
        upstream,
        acknowledged: !loseAck,
      });
      if (loseAck) {
        loseAck = false;
        res.destroy(); // Commit succeeded; the app never receives its ACK.
      } else res.writeHead(upstream).end();
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", resolve),
  );
  const address = receiver.address();
  assert(address && typeof address !== "string");
  const localEndpoint = `http://127.0.0.1:${address.port}/v1/telemetry/daily`;
  const ledger = new UsageLedger(path.join(dir, "usage.sqlite"), () => clock);
  await ledger.load();
  const usage = new UsageService(ledger, () => undefined);
  const deliveryFile = path.join(dir, "telemetry-delivery.json");
  let consent = await openTelemetryConsent(dir, {
    now: () => clock,
    delivery: {
      consentChanged: (t) => uploader?.consentChanged(t) ?? Promise.resolve(),
      sealedReport: (d) => uploader?.sealedReport(d) ?? Promise.resolve(null),
    },
  });
  const server = new AppBackendServer({
    version: "1.2.3-local",
    snapshot: createTestSnapshot(),
    usage,
    telemetryConsent: consent,
    telemetryActivity: { activity: () => uploader!.activity() },
  });
  const rpc = async (method: string, params?: unknown) => {
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });
    assert(response && "result" in response, JSON.stringify(response));
    return response.result as any;
  };
  const activity = () => rpc(backendMethods.telemetryActivity);
  const change = (action: string) =>
    rpc(backendMethods.telemetryConsentChange, { action });
  const preview = (day: string) =>
    rpc(backendMethods.telemetryProfilePreview, { day });
  const store = async () => JSON.parse(await readFile(deliveryFile, "utf8"));
  const until = async (check: () => Promise<void>) => {
    let error: unknown;
    for (let n = 0; n < 500; n++) {
      try {
        await check();
        return;
      } catch (e) {
        error = e;
        await pause(10);
      }
    }
    throw error;
  };
  const open = async (configured = true) => {
    scheduler?.stop();
    await uploader?.close();
    uploader = await TelemetryUploadService.open({
      file: deliveryFile,
      consent: () => consent.current(),
      usage,
      version: "1.2.3-local",
      platform: process.platform,
      endpoint: configured ? localEndpoint : undefined,
      foreground: async () => false,
      now: () => clock,
      random: () => 0.5,
      fetch: async (url, init) => {
        transportUrls.push(String(url));
        assert.equal(String(url), localEndpoint);
        return fetch(url, init);
      },
    });
    scheduler = new RuntimeScheduler();
    scheduler.register({id:'telemetry-upload',intervalMs:3600000,runOnStart:true,run:()=>uploader!.flush()});
    scheduler.start();
    scheduler.start();
  };
  try {
    await open();
    assert.deepEqual(await rpc(backendMethods.telemetryConsentGet), {enabled:undefined});
    await activity();
    assert.equal(
      (await preview(new Date(clock).toISOString().slice(0, 10))).kind,
      "hypothetical",
    );
    await change("disable");
    await open();
    assert.equal(
      (await rpc(backendMethods.telemetryConsentGet)).enabled,
      false,
    );
    await change("disable"); // Explicit decline is also off.
    await pause(50);
    assert.equal(transportUrls.length, 0);
    // Missing legacy telemetry state is the same fail-closed initialization as a
    // new profile, independently of the ordinary app's existing settings.
    const legacy = await openTelemetryConsent(
      path.join(dir, "legacy"),
    );
    assert.deepEqual(await legacy.view(), {
      enabled: undefined,
    });
    clock = today - 3 * DAY;
    const enabled = await change("enable");
    assert.equal(enabled.enabled, true);
    clock = today - 3 * DAY + 3600000;
    const reportDay = new Date(clock).toISOString().slice(0, 10);
    await Promise.all([activity(), activity(), activity()]); // Multiple windows.
    const canary = "PRIVATE_CONTENT_CANARY_57319";
    assert.equal(
      await ledger.observe(
        {
          provider: "codex",
          agentId: canary,
          sessionId: canary,
          turnId: canary,
          model: `${canary}-alias`,
          phase: "started",
          at: clock,
        },
        { teamId: canary, repository: `${canary}/repository/branch` },
      ),
      true,
    );
    assert.equal(
      await ledger.observe(
        {
          provider: "codex",
          agentId: canary,
          sessionId: canary,
          turnId: canary,
          model: `${canary}-alias`,
          phase: "completed",
          timing: { activeMs: 1300, ttftMs: 300 },
          at: clock,
          tokens: {
            input: 100,
            cacheRead: 80,
            cacheWrite: null,
            output: 20,
            reasoning: 5,
          },
        },
        { teamId: canary, repository: `${canary}/repository/branch` },
      ),
      true,
    );
    assert.equal((await preview(reportDay)).kind, "provisional");
    clock = today - 2 * DAY + 1000;
    await uploader!.flush();
    await until(async () =>
      assert.equal(
        (await store()).days.find((d: any) => d.day === reportDay)?.attempts,
        1,
      ),
    );
    await until(async () => assert.equal(attempts.length, 1));
    assert.equal(attempts[0]!.upstream, 204);
    const sealed = (await uploader!.sealedReport(reportDay,1))!;
    assert.equal(sealed.body, attempts[0]!.body);
    assert.equal(sealed.body.includes(canary), false);
    assert.deepEqual(JSON.parse(sealed.body).usage, [
      {
        provider: "codex",
        model: "unknown",
        serviceTier: "unknown",
        turns: 1,
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
        estimatedCostUsd: null,
        measuredTurns: 1,
        costCoverage: "unavailable",
        performance: { speedTurns: 1, outputTokens: 20, generationMs: 1000, ttftMs: 300, ttftTurns: 1 },
      },
    ]);
    await uploader!.close();
    clock += 61000;
    await open();
    await until(async () =>
      assert.equal(
        (await store()).days.find((d: any) => d.day === reportDay)?.status,
        "done",
      ),
    );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1]!.body, sealed.body);
    await activity(); // A separate empty-use hour, uploaded on the next flush.
    await Promise.all([activity(), activity()]);
    await pause(50);
    assert.equal(attempts.length, 2);
    clock = today - DAY + 1000;
    await open();
    await until(async () => assert.equal(attempts.length, 3));
    const empty = JSON.parse(attempts[2]!.body);
    assert.deepEqual(empty.usage, []);
    await change("disable");
    assert.deepEqual((await store()).days, []);
    const oldIdentity = consent.current().installId;
    await change("reset");
    assert.notEqual(consent.current().installId, oldIdentity);
    assert.equal(consent.current().enabled, false);
    await activity();
    await open();
    await pause(50);
    assert.equal(attempts.length, 3);
    // Endpoint absence suppresses even opted-in transport, including restart.
    await open(false);
    await change("enable");
    clock = today + 1000;
    await activity();
    clock += DAY;
    await open(false);
    await until(async () =>
      assert.equal((await store()).days[0]?.status, "pending"),
    );
    const resetBody = JSON.parse((await store()).days[0].body);
    assert.notEqual(resetBody.installId, oldIdentity);
    assert.deepEqual(
      resetBody.usage,
      [],
      "the new reporting day has no ledger usage",
    );
    assert.equal(transportUrls.length, 3);
    await change("reset");
    assert.deepEqual((await store()).days, []);
    // Reopen authoritative state from disk; identity/notice/off persist.
    consent = await openTelemetryConsent(dir);
    assert.deepEqual(await consent.view(), {
      enabled: false,

    });
    return {
      boundary:
        "real desktop backend RPC/profile/ledger/uploader; synthetic clock/lifecycle; no live providers",
      offRequests: 0,
      noEndpointRequests: 0,
      physicalAttempts: attempts.length,
      logicalReports: 2,
      lostAcknowledgements: 1,
      canonicalRetryBytesEqual: true,
      duplicateWindowNotifications: 5,
      resetPurged: true,
      restartAcknowledgementPreserved: true,
      reportDay,
      emptyDay: empty.day,
      attempts,
    };
  } finally {
    scheduler?.stop();
    await uploader?.close();
    await server.close();
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.APP_HOME;
    else process.env.APP_HOME = previousHome;
  }
}
