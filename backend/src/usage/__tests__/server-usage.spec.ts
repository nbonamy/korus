import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { UsageService } from "../usage-service";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";
import type { BackendDriverRpc } from "../../driver-rpc";
it("clears queued statistics through the app contract without resurrecting legacy data or touching provider history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-clear-"));
  const legacy = path.join(dir, "usage.json"),
    file = path.join(dir, "usage.sqlite"),
    history = path.join(dir, "provider-history.json");
  const at = Date.now();
  const observation = {
    provider: "codex",
    model: null,
    agentId: "a",
    sessionId: "s",
    turnId: "legacy",
    phase: "completed",
    startedAt: at,
    at,
  };
  await writeFile(
    legacy,
    JSON.stringify({ since: at, records: [observation] }),
  );
  await writeFile(history, "provider-owned");
  const local = new UsageLedger(file, Date.now, legacy);
  await local.load();
  const usage = new UsageService(local, () => undefined);
  const server = new AppBackendServer({
    version: "test",
    snapshot: createTestSnapshot(),
    usage,
  });
  const call = (method: string, params: unknown = {}) =>
    server.handleMessage({ jsonrpc: "2.0", id: 1, method, params });
  try {
    usage.observe({
      ...observation,
      provider: "codex",
      phase: "started",
      turnId: "queued",
    });
    expect(
      await call("usage/clear", { filter: { provider: "codex" } }),
    ).toHaveProperty("error");
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [{ started: 2 }] },
    });
    expect(await call("usage/clear")).toMatchObject({ result: null });
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [], daily: [] },
    });
    await expect(readFile(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(history, "utf8")).toBe("provider-owned");
    await local.close();
    const reopened = new UsageLedger(file, Date.now, legacy);
    try {
      await reopened.load();
      expect(reopened.query().rows).toStrictEqual([]);
      expect(reopened.query().recordedSince).toBeGreaterThanOrEqual(at);
    } finally {
      await reopened.close();
    }
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("queries provider observations locally and rejects the retired reporting API", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-local-rpc-"));
  const local = new UsageLedger(path.join(dir, "usage.sqlite"));
  await local.load();
  const usage = new UsageService(local, () => undefined);
  let observe!: (event: ExecutionObservation) => void;
  const unsubscribe = vi.fn();
  const driver = {
    onUsage: (listener: typeof observe) => { observe = listener; return unsubscribe; },
    onEvent: () => () => undefined,
    handle: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BackendDriverRpc;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const server = new AppBackendServer({ version: "test", snapshot: createTestSnapshot(), usage, driverRpc: driver });
  const call = (method: string, params: unknown = {}) => server.handleMessage({ jsonrpc: "2.0", id: 1, method, params });
  const event = { provider: "codex" as const, agentId: "a", sessionId: "s", turnId: "t", model: null, at: Date.now() };
  try {
    observe({ ...event, phase: "started" });
    observe({ ...event, phase: "completed", tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: null, total: 15 } });
    expect(await call("usage/get", { filter: { group: "provider" } })).toMatchObject({ result: { rows: [{ label: "codex", started: 1, completed: 1, tokens: { total: 15 } }] } });
    expect(await call("telemetry/privacy/set", { choice: { enabled: true, disclosure: 2 } })).toMatchObject({ error: { code: -32601 } });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await server.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  }
});
