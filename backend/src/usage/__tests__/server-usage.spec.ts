import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect, vi } from "vitest";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { UsageService } from "../usage-service";
import { UsageLedger } from "../usage-ledger";
import type { ExecutionObservation } from "@workspace/core/usage";
import type { BackendDriverRpc } from "../../driver-rpc";
import { requestAppBackend } from "@workspace/core/backend-protocol/rpc";
import { backendMethods } from "@workspace/core/backend-protocol/methods";
import { ClaudeAgentSdkTransport } from "../../claude/agent-sdk-transport";
import { createQueryHarness } from "../../claude/__tests__/sdk-query-fixture";
import { codexExecutionConsumption } from "../../codex/execution-usage";
import { validConsumption } from "@workspace/core/usage";

it("previews exact local UTF-8 telemetry from persisted provider measurements without leaking local dimensions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "telemetry-preview-"));
  const file = path.join(dir, "usage.sqlite");
  const midnight = Date.parse("2026-10-16T00:00:00Z");
  let local = new UsageLedger(file, () => midnight + 60000);
  await local.load();
  const canary = "PRIVATE_CANARY_é";
  const attribution = {
    teamId: `${canary}-team`,
    repository: `${canary}/repository/branch`,
  };
  const base = {
    provider: "claude" as const,
    agentId: `${canary}-agent`,
    sessionId: canary,
    turnId: "claude",
    model: "sonnet",
    at: midnight - 1000,
  };
  const harness = createQueryHarness();
  const transport = new ClaudeAgentSdkTransport({
    createQuery: harness.createQuery,
  });
  try {
    let completed: Promise<boolean> | undefined;
    const turn = transport.startTurn(
      { cwd: dir, prompt: canary },
      (message) => {
        if (message.type === "result") {
          if (!validConsumption(message.executionConsumption))
            throw new Error("Missing normalized Claude consumption.");
          // The transport owns exclusive Claude raw input normalization.
          completed = local.observe(
            {
              ...base,
              phase: "completed",
              at: midnight + 1000,
              model: "claude-sonnet-4-6",
              tokens: message.executionConsumption,
              requestCoverage: "complete",
            },
            attribution,
          );
        }
      },
    );
    await vi.waitFor(() => expect(harness.inputs).toHaveLength(1));
    await local.observe(
      {
        ...base,
        phase: "started",
        prompt: canary,
        response: canary,
      } as ExecutionObservation,
      attribution,
    );
    harness.emit({
      type: "result",
      subtype: "success",
      session_id: "s",
      is_error: false,
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 6000,
        cache_creation_input_tokens: 3000,
        output_tokens: 1000,
      },
    });
    await turn.done;
    expect(await completed).toBe(true);
    // Request costs belong to the request day/model, independently of turn tokens.
    await local.observeRequest({
      ...base,
      at: midnight + 1000,
      requestId: "r",
      revision: 0,
      status: "final",
      apiProvider: "anthropic",
      model: "claude-opus-4-6",
      modality: "text",
      cacheMode: "explicit",
      tokens: {
        input: 10000,
        output: 1000,
        cacheRead: 6000,
        cacheWrite: { "5m": 3000 },
        reasoning: 200,
        inputIncludesCacheRead: true,
        inputIncludesCacheWrite: true,
        outputIncludesReasoning: true,
      },
      pricingContext: { context: 10000, region: "global" },
      requestedServiceTier: null,
      reportedServiceTier: "standard",
      reportedMode: null,
    });
    const codex = {
      ...base,
      provider: "codex" as const,
      turnId: "codex",
      model: "gpt-6-sol",
    };
    const normalized = codexExecutionConsumption({
      type: "conversation.executionUsageChanged",
      payload: {
        usage: {
          observedStart: true,
          model: "gpt-6-sol",
          execution: {
            inputTokens: 10000,
            cachedInputTokens: 8000,
            cacheWriteInputTokens: null,
            outputTokens: 1200,
            reasoningOutputTokens: 200,
            totalTokens: 11200,
          },
        },
      },
    })!;
    await local.observe({ ...codex, phase: "started" }, attribution);
    await local.observe(
      {
        ...codex,
        phase: "completed",
        at: midnight + 1000,
        tokens: normalized.tokens,
      },
      attribution,
    );
    for (const [turnId, tokens] of [
      ["measured", normalized.tokens],
      ["missing", null],
    ] as const) {
      await local.observe(
        {
          ...codex,
          turnId,
          model: `${canary}-custom-model`,
          phase: "started",
          tokens,
        },
        attribution,
      );
    }
    await local.close();
    local = new UsageLedger(file, () => midnight + 60000);
    await local.load();
    const usage = new UsageService(local, () => undefined);
    const server = new AppBackendServer({
      version: "0.44.0-beta.2+local-build",
      snapshot: createTestSnapshot(),
      usage,
    });
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network permitted"));
    const preview = async (
      day: string,
      eligibleFrom = midnight - 86400000,
      eligibleUntil: number | null = null,
    ) =>
      requestAppBackend(
        {
          request: async <T,>(method: string, params?: unknown): Promise<T> => {
            const response = await server.handleMessage({
              jsonrpc: "2.0",
              id: 1,
              method,
              params,
            });
            if (response && "result" in response) return response.result as T;
            throw new Error(JSON.stringify(response));
          },
        },
        backendMethods.telemetryPreview,
        {
          input: {
            installId: "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f",
            day,
            eligibleFrom,
            eligibleUntil,
          },
        },
      );
    try {
      const first = await preview("2026-10-15");
      const fixture = await readFile(
        new URL("./fixtures/daily-telemetry.json", import.meta.url),
      );
      // Fixture contains the canonical body itself, with no trailing newline.
      const expected = JSON.parse(fixture.toString());
      expected.os =
        process.platform === "darwin"
          ? "macos"
          : process.platform === "win32"
            ? "windows"
            : process.platform === "linux"
              ? "linux"
              : "unknown";
      expect(Buffer.from(first.body, "utf8")).toStrictEqual(
        process.platform === "darwin"
          ? fixture
          : Buffer.from(JSON.stringify(expected), "utf8"),
      );
      expect(first.body).not.toContain(canary);
      const next = await preview("2026-10-16");
      // 1k input * 5 + 6k reads * .5 + 3k writes * 6.25 + 1k output * 25, per million.
      expect(JSON.parse(next.body).usage).toStrictEqual([
        {
          provider: "claude",
          model: "claude-opus-4-6",
          turns: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0.05175,
        },
      ]);
      expect(
        JSON.parse((await preview("2026-10-16", midnight)).body).usage,
      ).toStrictEqual([]);
      expect(
        JSON.parse(
          (await preview("2026-10-16", midnight - 86400000, midnight)).body,
        ).usage,
      ).toStrictEqual([]);
      expect(
        JSON.parse((await preview("2026-10-14")).body).usage,
      ).toStrictEqual([]);
      expect(await preview("2026-10-15")).toStrictEqual(first);
      usage.observe({
        ...codex,
        phase: "usage",
        tokens: { ...normalized.tokens!, input: 20000 },
      });
      const corrected = await preview("2026-10-15");
      expect(JSON.parse(corrected.body).usage[1].inputTokens).toBe(20000);
      expect(first.body).not.toBe(corrected.body); // A sealed preview never changes with later observations.
      expect(network).not.toHaveBeenCalled();
      for (const patch of [
        { eligibleFrom: undefined },
        { eligibleFrom: NaN },
        { eligibleUntil: midnight - 86400001 },
        { prompt: canary },
        { day: "invalid" },
      ]) {
        expect(
          await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: backendMethods.telemetryPreview,
            params: {
              input: {
                installId: "d8b65ff5-179c-49b9-ac3a-f60a54a0f43f",
                day: "2026-10-15",
                eligibleFrom: midnight - 86400000,
                eligibleUntil: null,
                ...patch,
              },
            },
          }),
        ).toHaveProperty("error");
      }
    } finally {
      network.mockRestore();
      await server.close();
    }
  } finally {
    await transport.close();
    await local.close();
    await rm(dir, { recursive: true, force: true });
  }
});
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
