import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer, type Server } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { TelemetryUploadService } from "../upload-service";
import { TelemetryConsentService } from "../consent-service";
import { UsageLedger } from "../../usage/usage-ledger";
import { UsageService } from "../../usage/usage-service";

// Owner boundary: real private files + ledger + consent; only time and transport
// are controlled. Risks: replay, duplicate owners, pre-consent/daemon activity,
// stale authority across awaits, lost ACK, corrupt state, retry/expiry and leaks.
const DAY = 86_400_000;
const epoch = Date.parse("2026-10-10T12:00:00Z");
let directory: string;
let upload: TelemetryUploadService | undefined;
let usage: UsageService;
let consent: TelemetryConsentService;
let clock: number;
let receiver: Server | undefined;
const fetcher = vi.fn<typeof fetch>();
const foreground = vi.fn(async () => false);
async function eventually(check: () => unknown | Promise<unknown>) {
  let failure: unknown;
  for (let i = 0; i < 1000; i++) {
    try {
      await check();
      return;
    } catch (error) {
      failure = error;
      await pause(2);
    }
  }
  throw failure;
}
const day = () => new Date(clock).toISOString().slice(0, 10);
const advance = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
};
async function open(
  endpoint: string | undefined = "https://collector.invalid/v1/telemetry/daily",
  real = false,
  random = () => 0.5,
) {
  upload = await TelemetryUploadService.open({
    file: path.join(directory, "delivery.json"),
    consent: () => consent.current(),
    usage,
    version: "1.2.3-local",
    platform: "darwin",
    endpoint,
    now: () => clock,
    random,
    foreground,
    ...(real ? {} : { fetch: fetcher }),
  });
  upload.start();
  return upload;
}
async function eligibleActivity() {
  await consent.change("enable");
  await advance(DAY);
  await upload!.activity();
  return day();
}
async function pendingDay() {
  const reporting = await eligibleActivity();
  await advance(DAY);
  return reporting;
}
async function stored() {
  return JSON.parse(
    await readFile(path.join(directory, "delivery.json"), "utf8"),
  );
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  directory = await mkdtemp(path.join(os.tmpdir(), "telemetry-upload-"));
  clock = epoch;
  const ledger = new UsageLedger(
    path.join(directory, "usage.sqlite"),
    () => clock,
  );
  await ledger.load();
  usage = new UsageService(ledger, () => undefined);
  consent = await TelemetryConsentService.open(
    path.join(directory, "consent.json"),
    {
      now: () => clock,
      delivery: {
        consentChanged: (transition) =>
          upload?.consentChanged(transition) ?? Promise.resolve(),
        sealedReport: (report) =>
          upload?.sealedReport(report) ?? Promise.resolve(null),
      },
    },
  );
  fetcher.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  foreground.mockReset().mockResolvedValue(false);
});
afterEach(async () => {
  await upload?.close();
  upload = undefined;
  await usage.close();
  if (receiver) {
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver!.close(() => resolve()));
    receiver = undefined;
  }
  await rm(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

it("makes no telemetry requests off or without an endpoint, and never turns daemon time into activity", async () => {
  await open();
  await upload!.activity();
  await advance(2 * DAY);
  await consent.preview(day(), usage, "1.2.3", "darwin");
  await consent.change("dismiss");
  expect(fetcher).not.toHaveBeenCalled();
  await consent.change("enable");
  await advance(2 * DAY);
  expect(fetcher).not.toHaveBeenCalled();
  await upload!.close();
  await open("");
  await upload!.activity();
  await advance(DAY);
  await eventually(async () => expect((await stored()).days).toHaveLength(1));
  expect(fetcher).not.toHaveBeenCalled();
  await consent.change("reset");
  expect((await stored()).days).toStrictEqual([]);
});

it("seals empty active days once, previews exact bytes and never replays acknowledged days after restart", async () => {
  await open();
  // Before eligibility must not become a report.
  await consent.change("enable");
  await upload!.activity();
  await advance(DAY);
  const reporting = day();
  await Promise.all([
    upload!.activity(),
    upload!.activity(),
    upload!.activity(),
  ]);
  await advance(DAY);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = fetcher.mock.calls[0]![1]!.body as string;
  expect(JSON.parse(body)).toStrictEqual({
    installId: consent.current().installId,
    day: reporting,
    appVersion: "1.2.3",
    os: "macos",
    usage: [],
  });
  expect(
    await consent.preview(reporting, usage, "9.9.9", "linux"),
  ).toStrictEqual({ kind: "sealed", body });
  await eventually(async () =>
    expect((await stored()).days[0].status).toBe("done"),
  );
  await upload!.close();
  await open();
  upload!.start();
  upload!.start();
  await advance(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await upload!.sealedReport(reporting)).toStrictEqual({ body });
});

it("records a day only on confirmed desktop foreground, including crossing midnight", async () => {
  await open();
  await consent.change("enable");
  await advance(DAY);
  foreground.mockResolvedValue(true);
  await advance(60_000);
  const reporting = day();
  await eventually(async () =>
    expect(
      (await stored()).days.map((row: { day: string }) => row.day),
    ).toContain(reporting),
  );
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(DAY);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).day).toBe(
    reporting,
  );
  await eventually(async () =>
    expect(
      (await stored()).days.some((row: { day: string }) => row.day === day()),
    ).toBe(true),
  );
  foreground.mockRejectedValue(new Error("desktop disconnected"));
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(DAY);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await advance(DAY);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("persists frozen retries across restart and drops after six total attempts", async () => {
  fetcher.mockRejectedValue(new Error("lost acknowledgement"));
  await open();
  const reporting = await pendingDay();
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = fetcher.mock.calls[0]![1]!.body;
  const state = consent.current();
  await upload!.consentChanged({
    reason: "enable",
    previous: state,
    current: state,
  });
  await upload!.consentChanged({
    reason: "enable",
    previous: state,
    current: state,
  });
  expect(await upload!.sealedReport(reporting)).toStrictEqual({ body });
  await eventually(async () =>
    expect((await stored()).days[0].attempts).toBe(1),
  );
  await upload!.close();
  await open();
  await advance(59_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  let attempts = 1;
  for (const delay of [1000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, DAY]) {
    await eventually(async () =>
      expect((await stored()).days[0].nextAttemptAt).toBe(clock + delay),
    );
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    await advance(delay);
    ++attempts;
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(attempts));
  }
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(6));
  await advance(2 * DAY);
  expect(fetcher).toHaveBeenCalledTimes(6);
  for (const [, init] of fetcher.mock.calls) expect(init!.body).toBe(body);
  expect(await upload!.sealedReport(reporting)).toStrictEqual({ body });
});

it.each([
  { status: 408, header: "120", wait: 120_000 },
  { status: 429, header: "99999999", wait: DAY },
  {
    status: 500,
    header: new Date(epoch + 2 * DAY + 120_000).toUTCString(),
    wait: 120_000,
  },
  { status: 503, header: "invalid", wait: 60_000 },
])(
  "retries status $status with bounded Retry-After without leaking credentials",
  async ({ status, header, wait }) => {
    fetcher.mockResolvedValueOnce(
      new Response(null, { status, headers: { "Retry-After": header } }),
    );
    await open();
    await pendingDay();
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await eventually(async () =>
      expect((await stored()).days[0].nextAttemptAt).toBe(clock + wait),
    );
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    await advance(wait - 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1000);
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const [, init] = fetcher.mock.calls[0]!;
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
    });
    expect(Object.keys(init!.headers!)).toStrictEqual(["Content-Type"]);
  },
);

it.each([400, 401, 403, 404, 302])(
  "drops permanent/redirect status %s without following it",
  async (status) => {
    fetcher.mockResolvedValue(
      new Response(null, {
        status,
        headers: { Location: "https://other.invalid" },
      }),
    );
    await open();
    await pendingDay();
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await advance(2 * DAY);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("aborts at ten seconds, on opt-out/reset, and on shutdown; never retries revoked identities", async () => {
  const signals: AbortSignal[] = [];
  fetcher.mockImplementation(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init!.signal!;
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  );
  await open();
  await pendingDay();
  await eventually(() => expect(signals).toHaveLength(1));
  await advance(9999);
  expect(signals[0]!.aborted).toBe(false);
  await advance(1);
  expect(signals[0]!.aborted).toBe(true);
  await eventually(async () =>
    expect((await stored()).days[0].nextAttemptAt).toBe(clock + 60_000),
  );
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(60_000);
  await eventually(() => expect(signals).toHaveLength(2));
  await consent.change("disable");
  expect(signals[1]!.aborted).toBe(true);
  expect((await stored()).days).toStrictEqual([]);
  const oldId = consent.current().installId;
  await consent.change("reset");
  expect(consent.current().installId).not.toBe(oldId);
  await advance(DAY);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await pendingDay();
  await eventually(() => expect(signals).toHaveLength(3));
  await upload!.close();
  expect(signals[2]!.aborted).toBe(true);
});

it("cannot export a seal completed after reset, and never makes consent wait for ledger work", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = usage.previewTelemetry.bind(usage);
  vi.spyOn(usage, "previewTelemetry").mockImplementation(async (...args) => {
    await blocked;
    return original(...args);
  });
  await open();
  await pendingDay();
  await eventually(() =>
    expect(usage.previewTelemetry).toHaveBeenCalledTimes(1),
  );
  await consent.change("reset");
  expect((await stored()).days).toStrictEqual([]);
  release();
  await advance(60_000);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await stored()).days).toStrictEqual([]);
});

it("expires old markers, bounds storage and rejects corrupt or obsolete persisted delivery state", async () => {
  await open();
  await eligibleActivity();
  await upload!.close();
  clock += 8 * DAY;
  await open();
  await advance(60_000);
  expect(fetcher).not.toHaveBeenCalled();
  await eventually(async () => expect((await stored()).days).toStrictEqual([]));
  await upload!.close();
  await open("");
  for (let i = 0; i < 10; i++) {
    await upload!.activity();
    await advance(DAY);
  }
  await upload!.activity();
  expect((await stored()).days).toHaveLength(8);
  expect(fetcher).not.toHaveBeenCalled();
  await upload!.close();
  await writeFile(
    path.join(directory, "delivery.json"),
    '{"body":"PRIVATE_CANARY"}',
  );
  await open();
  await upload!.activity();
  await advance(DAY);
  expect(fetcher).not.toHaveBeenCalled();
  await consent.change("reset");
  expect((await stored()).days).toStrictEqual([]);
});

it("records a reproducible off/on loopback trace and sends exactly the sealed UTF-8 bytes", async () => {
  vi.useRealTimers();
  const trace: { body: string; headers: Record<string, unknown> }[] = [];
  receiver = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      trace.push({ body, headers: request.headers });
      if (trace.length === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise<void>((resolve) =>
    receiver!.listen(0, "127.0.0.1", resolve),
  );
  const address = receiver.address() as import("node:net").AddressInfo;
  await open(`http://127.0.0.1:${address.port}/v1/telemetry/daily`, true);
  await upload!.activity();
  await consent.preview(day(), usage, "1.2.3", "darwin");
  expect(trace).toStrictEqual([]);
  await consent.change("enable");
  clock += DAY;
  await upload!.activity();
  const reporting = day();
  clock += DAY;
  await upload!.activity();
  await eventually(() => expect(trace).toHaveLength(1));
  const sealed = await consent.preview(reporting, usage, "1.2.3", "darwin");
  expect(sealed.kind).toBe("sealed");
  expect(trace[0]!.body).toBe(sealed.body);
  await upload!.close();
  clock += 60_001;
  await open(`http://127.0.0.1:${address.port}/v1/telemetry/daily`, true);
  await eventually(() => expect(trace).toHaveLength(2));
  expect(trace[1]!.body).toBe(sealed.body);
  expect(trace[1]!.headers.cookie).toBeUndefined();
  expect(trace[1]!.headers.authorization).toBeUndefined();
  await consent.change("disable");
  await upload!.activity();
  expect(trace).toHaveLength(2);
  const artifact = {
    offRequests: 0,
    onAttempts: trace.length,
    sealedBody: sealed.body,
    retryBytesMatch: trace.every((row) => row.body === sealed.body),
    optOutRequests: 0,
  };
  await writeFile(
    path.join(directory, "network-trace.json"),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.retryBytesMatch).toBe(true);
  // Retain optional repeatable evidence outside Git; no concrete endpoint is recorded.
  if (process.env.TELEMETRY_TEST_EVIDENCE) {
    await writeFile(
      process.env.TELEMETRY_TEST_EVIDENCE,
      JSON.stringify(artifact, null, 2),
    );
  }
});

it("does not send activity that expires while a ledger projection is in progress", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = usage.previewTelemetry.bind(usage);
  vi.spyOn(usage, "previewTelemetry").mockImplementation(async (...args) => {
    await blocked;
    return original(...args);
  });
  await open();
  await pendingDay();
  try {
    await eventually(() =>
      expect(usage.previewTelemetry).toHaveBeenCalledTimes(1),
    );
    clock += 8 * DAY;
    release();
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("freezes real ledger measurements once even when a late provider correction arrives before retry", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const projection = vi.spyOn(usage, "previewTelemetry");
  await open();
  const reporting = await eligibleActivity();
  const observation = {
    provider: "codex" as const,
    agentId: "PRIVATE_CANARY-agent",
    sessionId: "PRIVATE_CANARY-session",
    turnId: "t",
    model: "unknown",
    at: clock,
    phase: "completed" as const,
  };
  await usage.local.observe(
    { ...observation, phase: "started" },
    { teamId: "PRIVATE_CANARY", repository: "PRIVATE_CANARY/path/branch" },
  );
  // Use the ledger's normalized consumption contract (reasoning is already output).
  await usage.local.observe(
    {
      ...observation,
      tokens: {
        input: 100,
        cacheRead: 60,
        cacheWrite: null,
        output: 12,
        reasoning: 3,
      },
    },
    { teamId: "PRIVATE_CANARY", repository: "PRIVATE_CANARY/path/branch" },
  );
  await advance(DAY);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = fetcher.mock.calls[0]![1]!.body as string;
  expect(JSON.parse(body).usage).toStrictEqual([
    {
      provider: "codex",
      model: "unknown",
      turns: 1,
      inputTokens: 100,
      cachedInputTokens: 60,
      outputTokens: 12,
      estimatedCostUsd: null,
    },
  ]);
  expect(body).not.toContain("PRIVATE_CANARY");
  await usage.local.observe(
    {
      ...observation,
      phase: "usage",
      tokens: {
        input: 999,
        cacheRead: 600,
        cacheWrite: null,
        output: 99,
        reasoning: 3,
      },
    },
    { teamId: null, repository: null },
  );
  await eventually(async () =>
    expect((await stored()).days[0].nextAttemptAt).toBe(clock + 60_000),
  );
  await advance(60_000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]![1]!.body).toBe(body);
  expect(projection).toHaveBeenCalledTimes(1);
  expect(await upload!.sealedReport(reporting)).toStrictEqual({ body });
});

it("bounds jitter and never schedules more than twenty-four hours between attempts", async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 503 }));
  await open("https://collector.invalid/v1/telemetry/daily", false, () => 1);
  await pendingDay();
  let attempts = 1;
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(attempts));
  for (const delay of [
    72_000,
    18 * 60_000,
    72 * 60_000,
    7.2 * 60 * 60_000,
    DAY,
  ]) {
    await eventually(async () =>
      expect((await stored()).days[0].nextAttemptAt).toBe(clock + delay),
    );
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    await advance(delay);
    ++attempts;
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(attempts));
  }
});
