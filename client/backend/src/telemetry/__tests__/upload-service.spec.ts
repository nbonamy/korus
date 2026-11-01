import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer, type Server } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { TelemetryUploadService } from "../upload-service";
import type { TelemetryConsentService } from "../consent-service";
import { openTelemetryConsent } from "./settings-fixture";
import { RuntimeScheduler } from "../../scheduling/runtime-scheduler";
import { UsageLedger } from "../../usage/usage-ledger";
import { UsageService } from "../../usage/usage-service";
import { AppStateStore } from "../../persistence/store";

// Owner boundary: real private files + ledger + consent; only time and transport
// are controlled. Risks: replay, duplicate owners, pre-consent/daemon activity,
// stale authority across awaits, lost ACK, corrupt state, retry/expiry and leaks.
const DAY = 86_400_000;
const epoch = Date.parse("2026-10-10T12:00:00Z");
let directory: string;
let upload: TelemetryUploadService | undefined;
let scheduler: RuntimeScheduler | undefined;
let usage: UsageService;
let consent: TelemetryConsentService;
let clock: number;
let receiver: Server | undefined;
const fetcher = vi.fn<typeof fetch>();
const foreground = vi.fn(async () => false);
const now = () => (vi.isFakeTimers() ? Date.now() : clock);
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
  // Advance authority time alongside timer time. Jumping authority to the end
  // first makes maintenance repeatedly schedule against a stationary future.
  vi.setSystemTime(clock);
  await vi.advanceTimersByTimeAsync(ms);
  clock += ms;
};
async function open(
  endpoint: string | undefined = "https://collector.invalid/v1/telemetry/daily",
  real = false,
  random = () => 0.5,
) {
  if (vi.isFakeTimers()) vi.setSystemTime(clock);
  upload = await TelemetryUploadService.open({
    file: path.join(directory, "delivery.json"),
    consent: () => consent.current(),
    usage,
    version: "1.2.3-local",
    platform: "darwin",
    endpoint,
    now,
    random,
    foreground,
    ...(real ? {} : { fetch: fetcher }),
  });
  scheduler?.stop();
  scheduler = new RuntimeScheduler();
  scheduler.register({id:"telemetry-upload",intervalMs:3600000,runOnStart:true,run:()=>upload!.flush()});
  scheduler.start();
  return upload;
}
async function activeHour() {
  await consent.change("enable");
  await upload!.activity();
  return day();
}
async function pendingHour() {
  const reporting = await activeHour();
  await advance(3600000);
  return reporting;
}
async function stored() {
  return JSON.parse(
    await readFile(path.join(directory, "delivery.json"), "utf8"),
  );
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  directory = await mkdtemp(path.join(os.tmpdir(), "telemetry-upload-"));
  clock = epoch;
  vi.setSystemTime(clock);
  const ledger = new UsageLedger(path.join(directory, "usage.sqlite"), now);
  await ledger.load();
  usage = new UsageService(ledger, () => undefined);
  consent = await openTelemetryConsent(
    directory,
    {
      now,
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
  scheduler?.stop();
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

it.each([
  ['00000000-0000-4000-8000-000000000030', 0],
  ['00000000-0000-4000-8000-00000000002f', 59],
] as const)("uploads at UUID minute %s/%i, keeping its slot across restart", async (installId, minute) => {
  const store = new AppStateStore(directory);
  await store.saveTelemetrySettings(await store.load(), {installId, enabled:true, enabledAt:epoch-3600000});
  consent = await openTelemetryConsent(directory, {now});
  usage.observe({provider:'codex', agentId:'a', sessionId:'s', turnId:'first', model:'gpt-6-sol', phase:'started', at:clock});
  await usage.drain();
  const start = async () => {
    upload = await TelemetryUploadService.open({
      file:path.join(directory,'delivery.json'), consent:()=>consent.current(), usage,
      version:'1.2.3', platform:'darwin', endpoint:'https://collector.invalid/v1/telemetry/daily',
      now, foreground, fetch:fetcher,
    });
    scheduler = new RuntimeScheduler();
    scheduler.register({id:'telemetry-upload',intervalMs:60000,runOnStart:true,run:()=>upload!.tick()});
    scheduler.start();
  };
  await start();
  if (minute) {
    await advance(minute*60000-1);
    expect(fetcher).not.toHaveBeenCalled();
    await advance(1);
  } else await advance(0);
  await eventually(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  await upload!.tick();
  await upload!.tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await eventually(async()=>expect((await stored()).days[0].status).toBe('done'));
  await advance(60000);
  scheduler!.stop();
  await upload!.close();
  usage.observe({provider:'codex', agentId:'a', sessionId:'s', turnId:'second', model:'gpt-6-sol', phase:'started', at:clock});
  await usage.drain();
  await start();
  await advance(59*60000-1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await advance(1);
  await eventually(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).usage[0].turns).toBe(minute===59 ? 1 : 2);
  await consent.change('disable');
  await advance(3600000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("makes no telemetry requests off or without an endpoint, and never turns daemon time into activity", async () => {
  await open();
  await upload!.activity();
  await advance(2 * DAY);
  await consent.preview(day(), usage, "1.2.3", "darwin");
  await consent.change("disable");
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

it("uploads new usage from today on the hourly scheduler without resending unchanged totals", async () => {
  await open();
  await consent.change('enable');
  await upload!.activity();
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).day).toBe(day());
  await upload!.flush();
  usage.observe({provider:'codex',agentId:'a',sessionId:'s',turnId:'one',model:'gpt-6-sol',at:clock,phase:'started',tokens:{input:10,cacheRead:0,cacheWrite:null,output:4}});
  await usage.drain();
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000 - 1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await advance(1);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).usage[0]).toMatchObject({turns:1,inputTokens:10,outputTokens:4});
  await upload!.flush();
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("catches up after a 24-hour shutdown, seals exact bytes and never replays acknowledged days", async () => {
  await open();
  await consent.change("enable");
  const reporting = day();
  await Promise.all([
    upload!.activity(),
    upload!.activity(),
    upload!.activity(),
  ]);
  scheduler!.stop();
  await upload!.close();
  await advance(DAY);
  expect(fetcher).not.toHaveBeenCalled();
  await open(); // Startup flush catches the persisted active day immediately.
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = fetcher.mock.calls[0]![1]!.body as string;
  expect(JSON.parse(body)).toStrictEqual({
    installId: consent.current().installId,
    day: reporting,
    hour:12,
    appVersion: "1.2.3",
    os: "macos",
    usage: [],
  });
  expect(
    JSON.parse((await consent.preview(reporting, usage, "9.9.9", "linux")).body).usage,
  ).toStrictEqual([]);
  await eventually(async () =>
    expect((await stored()).days[0].status).toBe("done"),
  );
  await upload!.close();
  await open();
  void upload!.flush();
  void upload!.flush();
  await advance(3600000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await upload!.sealedReport(reporting,12)).toStrictEqual({ body });
});

it("records hourly foreground activity across midnight without inventing disconnected usage", async () => {
  await open();
  await consent.change('enable');
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  clock = Math.floor(clock / DAY) * DAY + 23 * 3600000;
  vi.setSystemTime(clock);
  foreground.mockResolvedValue(true);
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({day:day(),hour:23});
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({day:day(),hour:0});
  foreground.mockRejectedValue(new Error('desktop disconnected'));
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("persists frozen retries across restart and drops after six total attempts", async () => {
  fetcher.mockRejectedValue(new Error("lost acknowledgement"));
  await open();
  const reporting = await pendingHour();
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
  expect(await upload!.sealedReport(reporting,12)).toStrictEqual({ body });
  await eventually(async () =>
    expect((await stored()).days[0].attempts).toBe(1),
  );
  await upload!.close();
  await open();
  expect(fetcher).toHaveBeenCalledTimes(1);
  let attempts = 1;
  for (const delay of [60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, DAY]) {
    await eventually(async () =>
      expect((await stored()).days[0].nextAttemptAt).toBe(clock + delay),
    );
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    await advance(Math.ceil(delay / 3600000) * 3600000);
    ++attempts;
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(attempts));
  }
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(6));
  await advance(2 * DAY);
  expect(fetcher).toHaveBeenCalledTimes(6);
  for (const [, init] of fetcher.mock.calls) expect(init!.body).toBe(body);
  expect(await upload!.sealedReport(reporting,12)).toStrictEqual({ body });
});

it.each([
  { status: 408, header: "120", wait: 120_000 },
  { status: 429, header: "99999999", wait: DAY },
  {
    status: 500,
    header: new Date(epoch + 3600000 + 120_000).toUTCString(),
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
    await pendingHour();
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await eventually(async () =>
      expect((await stored()).days[0].nextAttemptAt).toBe(clock + wait),
    );
    await eventually(() => expect(vi.getTimerCount()).toBe(1));
    await advance(wait - 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(Math.ceil(wait / 3600000) * 3600000 - wait + 1000);
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
    await pendingHour();
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
  await pendingHour();
  await eventually(() => expect(signals).toHaveLength(1));
  await advance(9999);
  expect(signals[0]!.aborted).toBe(false);
  await advance(1);
  expect(signals[0]!.aborted).toBe(true);
  await eventually(async () =>
    expect((await stored()).days[0].nextAttemptAt).toBe(clock + 60_000),
  );
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  await eventually(() => expect(signals).toHaveLength(2));
  await consent.change("disable");
  expect(signals[1]!.aborted).toBe(true);
  expect((await stored()).days).toStrictEqual([]);
  const oldId = consent.current().installId;
  await consent.change("reset");
  expect(consent.current().installId).not.toBe(oldId);
  await advance(DAY);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await pendingHour();
  await upload!.activity();void upload!.flush();
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
  await pendingHour();
  await eventually(() =>
    expect(usage.previewTelemetry).toHaveBeenCalledTimes(1),
  );
  await consent.change("reset");
  expect((await stored()).days).toStrictEqual([]);
  release();
  await advance(3600000);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await stored()).days).toStrictEqual([]);
});

it("keeps historical markers and rejects corrupt persisted delivery state", async () => {
  await open();
  await activeHour();
  await upload!.close();
  clock += 8 * DAY;
  await open();
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await eventually(async () => expect((await stored()).days[0].status).toBe("done"));
  fetcher.mockClear();
  await upload!.close();
  await open("");
  for (let i = 0; i < 10; i++) {
    await upload!.activity();
    await advance(DAY);
  }
  await upload!.activity();
  expect((await stored()).days).toHaveLength(12);
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
  await upload!.flush();
  await eventually(() => expect(trace).toHaveLength(1));
  const sealed = (await upload!.sealedReport(reporting,12))!;
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

it("keeps old activity eligible while a ledger projection is in progress", async () => {
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
  await pendingHour();
  try {
    await eventually(() =>
      expect(usage.previewTelemetry).toHaveBeenCalledTimes(1),
    );
    clock += 8 * DAY;
    vi.setSystemTime(clock);
    release();
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  } finally {
    release();
  }
});

it("retries frozen hourly bytes before uploading a late provider correction", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  const projection = vi.spyOn(usage, "previewTelemetry");
  await open();
  const reporting = await activeHour();
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
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const body = fetcher.mock.calls[0]![1]!.body as string;
  expect(JSON.parse(body).usage).toStrictEqual([
    {
      provider: "codex",
      model: "unknown",
      serviceTier: "unknown",
      turns: 1,
      inputTokens: 100,
      cachedInputTokens: 60,
      outputTokens: 12,
      estimatedCostUsd: null,
      measuredTurns: 1, costCoverage: "unavailable",
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
  // Persistence precedes arming the retry timer; wait for the owner to finish
  // scheduling before advancing its fake clock.
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]![1]!.body).toBe(body);
  expect(projection).toHaveBeenCalledTimes(1);
  await eventually(() => expect(vi.getTimerCount()).toBe(1));
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string).usage[0].inputTokens).toBe(999);

});

it("bounds jitter and never schedules more than twenty-four hours between attempts", async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 503 }));
  await open("https://collector.invalid/v1/telemetry/daily", false, () => 1);
  await pendingHour();
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
    await advance(Math.ceil(delay / 3600000) * 3600000);
    ++attempts;
    await eventually(() => expect(fetcher).toHaveBeenCalledTimes(attempts));
  }
});

it.each([true, false, undefined])("migrates a legacy sharing choice %s and installation ID into settings", async enabled => {
  const legacy = path.join(directory, 'telemetry.json');
  const installId = consent.current().installId;
  await rm(path.join(directory, 'settings.json'));
  await rm(path.join(directory, 'roster.json'));
  await writeFile(legacy, JSON.stringify({v:2,installId,enabled:enabled ?? false,eligibleFrom:null,noticeHandled:enabled !== undefined}));
  consent = await openTelemetryConsent(directory, {now});
  expect(await consent.view()).toStrictEqual({enabled});
  expect(consent.current().installId).toBe(installId);
  const saved = JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'));
  expect(saved.data.telemetry).toStrictEqual({installId,...(enabled !== undefined ? {enabled} : {}),...(enabled === true ? {enabledAt:clock} : {})});
  await expect(readFile(legacy)).rejects.toMatchObject({code:'ENOENT'});
});

it("catches up more than 200 historical hours with a persisted request budget and silent network failures", async () => {
  // A long-enabled profile catches up after shutdown, without a seven-day cutoff.
  const present = clock;
  clock -= 501 * 3600000;
  vi.setSystemTime(clock);
  await consent.change("enable");
  clock = present;
  vi.setSystemTime(clock);
  // More history than the previous queue limit; all observations stay in a private temp ledger.
  for (let i = 0; i < 225; i++) {
    await usage.local.observe(
      {
        provider: "codex",
        agentId: "a",
        sessionId: "s",
        turnId: String(i),
        model: "unknown",
        at: clock - (500 - i) * 3600000,
        phase: "started",
        tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: null },
      },
      { teamId: null, repository: null },
    );
  }
  fetcher.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_ERROR"));
  await open();
  await expect(upload!.flush()).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(10); // Respect source burst admission.
  expect((await stored()).days).toHaveLength(225);
  scheduler!.stop();
  await upload!.close();
  await open();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(10); // Restart also preserves the source burst budget.
  clock += 10_000;
  vi.setSystemTime(clock);
  await upload!.flush();
  clock += 10_000;
  vi.setSystemTime(clock);
  await upload!.flush();
  await upload!.close();
  await open();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(30); // Restart cannot reset admission.
  fetcher.mockResolvedValueOnce(
    new Response(null, { status: 429, headers: { "Retry-After": "3600" } }),
  );
  await advance(3600000);
  await eventually(() => expect(fetcher).toHaveBeenCalledTimes(31));
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(31); // One 429 pauses the whole backlog.
  scheduler!.stop();
  for (let i = 0; i < 24; i++) {
    clock += 3600000;
    vi.setSystemTime(clock);
    await upload!.flush();
  }
  expect(
    new Set(
      fetcher.mock.calls.map((call) => {
        const p = JSON.parse(call[1]!.body as string);
        return `${p.day}/${p.hour}`;
      }),
    ).size,
  ).toBe(225);
  expect(
    (await stored()).days.every(
      (row: { status: string }) => row.status === "done",
    ),
  ).toBe(true);
  const sent = fetcher.mock.calls.length;
  clock += 366 * DAY;
  vi.setSystemTime(clock);
  await usage.local.load();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(sent); // Retention must not overwrite old server totals with empty projections.
});

it("starts a new sharing window on re-enable and never uploads the disabled interval, including after restart", async () => {
  const observe = async (turnId: string, at: number, input: number) => {
    expect(
      await usage.local.observe(
        {
          provider: "codex",
          agentId: "a",
          sessionId: "s",
          turnId,
          model: "unknown",
          at,
          phase: "started",
          tokens: { input, cacheRead: 0, cacheWrite: null, output: 0 },
        },
        { teamId: null, repository: null },
      ),
    ).toBe(true);
  };
  await observe("before-consent", clock - 3600000, 999);
  await open();
  await consent.change("enable");
  await observe("shared", clock, 10);
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(fetcher.mock.calls[0]![1]!.body as string).usage[0].inputTokens,
  ).toBe(10);
  await consent.change("disable");
  scheduler!.stop();
  clock += 3600000;
  vi.setSystemTime(clock);
  await observe("disabled", clock, 999);
  clock += 3600000;
  vi.setSystemTime(clock);
  await consent.change("enable");
  const enabled = consent.current();
  await upload!.close();
  consent = await openTelemetryConsent(directory, {
    now,
    delivery: {
      consentChanged: (t) => upload?.consentChanged(t) ?? Promise.resolve(),
      sealedReport: (d) => upload?.sealedReport(d) ?? Promise.resolve(null),
    },
  });
  expect(consent.current()).toStrictEqual(enabled);
  await open();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await observe("shared-again", clock, 20);
  clock += 60_000;
  vi.setSystemTime(clock);
  await consent.change("enable"); // Idempotent, does not move the boundary.
  expect(consent.current()).toStrictEqual(enabled);
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(fetcher.mock.calls[1]![1]!.body as string).usage[0].inputTokens,
  ).toBe(20);
  const preview = await consent.preview(day(), usage, "1.2.3", "darwin");
  expect(JSON.parse(preview.body).usage[0].inputTokens).toBe(20);
});

it("waits for a complete reporting hour after a mid-hour enable instead of rewriting earlier shared totals", async () => {
  await open();
  await consent.change("enable");
  await upload!.activity();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await consent.change("disable");
  clock += 15 * 60_000;
  vi.setSystemTime(clock);
  await consent.change("enable");
  await upload!.activity();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  clock += 45 * 60_000;
  vi.setSystemTime(clock);
  await upload!.activity();
  await upload!.flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).hour).toBe(13);
});
