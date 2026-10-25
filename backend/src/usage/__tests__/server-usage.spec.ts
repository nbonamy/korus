import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { UsageService } from "../usage-service";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";
import type { BackendDriverRpc } from "../../driver-rpc";
it("clears queued statistics through the app contract and keeps them cleared after restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-clear-"));
  const file = path.join(dir, "usage.sqlite");
  const at = Date.now();
  const observation = {
    provider: "codex",
    model: null,
    agentId: "a",
    sessionId: "s",
    turnId: "queued",
    at,
  };
  const local = new UsageLedger(file);
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
    });
    expect(
      await call("usage/clear", { filter: { provider: "codex" } }),
    ).toHaveProperty("error");
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [{ started: 1 }] },
    });
    usage.observe({ ...observation, provider: "codex", phase: "started", turnId: "pending" });
    expect(await call("usage/clear")).toMatchObject({ result: null });
    expect(await call("usage/get")).toMatchObject({
      result: { rows: [], daily: [] },
    });
    await local.close();
    const reopened = new UsageLedger(file);
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

it("queries provider observations through the app contract and unsubscribes on shutdown", async () => {
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
  const server = new AppBackendServer({ version: "test", snapshot: createTestSnapshot(), usage, driverRpc: driver });
  const call = (method: string, params: unknown = {}) => server.handleMessage({ jsonrpc: "2.0", id: 1, method, params });
  const event = { provider: "codex" as const, agentId: "a", sessionId: "s", turnId: "t", model: null, at: Date.now() };
  try {
    observe({ ...event, phase: "started" });
    observe({ ...event, phase: "completed", tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: null, total: 15 } });
    expect(await call("usage/get", { filter: { group: "provider" } })).toMatchObject({ result: { rows: [{ label: "codex", started: 1, completed: 1, tokens: { total: 15 } }] } });
  } finally {
    await server.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await rm(dir, { recursive: true, force: true });
  }
});

it('routes request observations through usage/get with cost coverage and clears them through usage/clear', async () => {
  const local = new UsageLedger(':memory:');
  await local.load();
  const usage = new UsageService(local, () => undefined);
  let observe!: (event: ExecutionObservation) => void;
  let request!: (event: import('@workspace/core/usage').RequestObservation) => void;
  const unsub = vi.fn();
  const driver = {
    onUsage: (listener: typeof observe) => { observe = listener; return () => undefined; },
    onRequestUsage: (listener: typeof request) => { request = listener; return unsub; },
    onEvent: () => () => undefined, close: async () => undefined,
  } as unknown as BackendDriverRpc;
  const server = new AppBackendServer({ version: 'test', snapshot: createTestSnapshot(), usage, driverRpc: driver });
  const call = (method: string) => server.handleMessage({ jsonrpc: '2.0', id: 1, method, params: {} });
  const event = { provider: 'codex' as const, agentId: 'a', sessionId: 's', turnId: 't', model: 'gpt-6-sol', at: Date.now() };
  try {
    observe({ ...event, phase: 'started' });
    request({ ...event, requestId: 'r', revision: 0, status: 'final', apiProvider: 'openai', modality: 'text', cacheMode: 'implicit',
      tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: {}, reasoning: 10, inputIncludesCacheRead: true, inputIncludesCacheWrite: true, outputIncludesReasoning: true },
      pricingContext: { context: 1000, region: null }, requestedServiceTier: 'priority', reportedServiceTier: 'standard', reportedMode: null });
    observe({ ...event, phase: 'completed', requestCoverage: 'complete' });
    expect(await call('usage/get')).toMatchObject({ result: { cost: { usd: 0.003, coverage: 'complete', requests: 1 } } });
    await call('usage/clear');
    expect(await call('usage/get')).toMatchObject({ result: { cost: { usd: null, requests: 0 }, rows: [] } });
  } finally { await server.close(); expect(unsub).toHaveBeenCalledOnce(); }
});
