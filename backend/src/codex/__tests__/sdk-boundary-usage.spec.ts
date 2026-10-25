import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UsageLedger } from "../../usage/usage-ledger";
import { UsageService } from "../../usage/usage-service";
import { AppBackendServer } from "../../server";
import { createTestSnapshot } from "../../__tests__/server-test-fixtures";
import { expect, it } from "vitest";
import type { CodexConversationEvent } from "@codex-app-sdk/core/surface";
import type { ExecutionObservation, UsageSummary } from "@workspace/core/usage";
import { codexSdkFixture, sdkAgent } from "./sdk-surface-fixture";
const metadata = {
  seq: 1,
  origin: "notification" as const,
  occurredAt: "2026-10-11T00:00:00Z",
  conversationId: "conversation-a",
  turnId: "turn-a",
};
it("attributes usage to the selected and rerouted model while preserving token semantics", async () => {
  const { driver, conversation } = codexSdkFixture();
  const observations: ExecutionObservation[] = [];
  driver.onUsage((e) => observations.push(e));
  try {
    await driver.loadConversation(sdkAgent());
    expect(observations).toStrictEqual([]);
    const c = conversation("conversation-a");
    c.setSnapshot({
      models: [
        { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
      ],
      selectedModelId: "gpt-5.6-sol",
      selectedReasoningEffort: "high",
      selectedServiceTier: "fast",
    });
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
    expect(observations[0]).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      serviceTier: "fast",
    });
    const count = {
      totalTokens: 120,
      inputTokens: 100,
      cachedInputTokens: 50,
      cacheWriteInputTokens: null,
      outputTokens: 20,
      reasoningOutputTokens: 10,
    };
    const usage = {
      observedStart: true,
      last: count,
      total: count,
      execution: count,
      model: null,
    };
    const emitUsage = (projection: unknown) =>
      c.emit({
        ...metadata,
        type: "conversation.executionUsageChanged",
        payload: { usage: projection },
      } as unknown as CodexConversationEvent);
    emitUsage({ ...usage, observedStart: false, execution: null });
    expect(observations).toHaveLength(1);
    emitUsage(usage);
    expect(observations[1]).toMatchObject({
      phase: "usage",
      model: null,
      tokens: {
        input: 100,
        output: 20,
        cacheRead: 50,
        cacheWrite: null,
        reasoning: 10,
      },
    });
    c.emit({
      ...metadata,
      type: "turn.modelRerouted",
      payload: {
        fromModel: "gpt-5.6-sol",
        toModel: "gpt-6.1",
        reason: "highRiskCyberActivity",
      },
    } as CodexConversationEvent);
    expect(observations[2]).toMatchObject({ phase: "usage", model: "gpt-6.1" });
    c.emit({
      ...metadata,
      type: "turn.completed",
      payload: {
        status: "completed",
        error: null,
        willRetry: false,
        startedAt: metadata.occurredAt,
        completedAt: metadata.occurredAt,
        durationMs: 100,
        executionUsage: usage,
      },
    } as unknown as CodexConversationEvent);
    emitUsage({ ...usage, execution: null });
    expect(observations.at(-1)).toMatchObject({ phase: "usage", tokens: null });
    expect(observations.map((e) => e.phase)).toStrictEqual([
      "started",
      "usage",
      "usage",
      "completed",
      "usage",
    ]);
  } finally {
    await driver.close();
  }
});
it("treats the SDK non-retrying error as terminal without counting retriable errors as new executions", async () => {
  const { driver, conversation } = codexSdkFixture();
  const observations: ExecutionObservation[] = [];
  driver.onUsage((e) => observations.push(e));
  try {
    await driver.loadConversation(sdkAgent());
    const c = conversation("conversation-a");
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
    expect(observations[0]).toMatchObject({
      reasoningEffort: null,
      serviceTier: "normal",
    });
    const error = {
      message: "CANARY_private_error",
      codexErrorInfo: null,
      additionalDetails: null,
    };
    c.emit({
      ...metadata,
      type: "turn.error",
      payload: { error, willRetry: true },
    } as CodexConversationEvent);
    expect(observations).toHaveLength(1);
    c.emit({
      ...metadata,
      type: "turn.error",
      payload: { error, willRetry: false },
    } as CodexConversationEvent);
    expect(observations.map((e) => e.phase)).toEqual(["started", "failed"]);
    expect(JSON.stringify(observations)).not.toContain("CANARY");
  } finally {
    await driver.close();
  }
});

// Protect the SDK-owned request boundary: execution counters must never become
// invented billable requests, even across terminal events, replay and restart.
it.each(["completed", "interrupted", "failed"] as const)(
  "retains precise request capability gaps and cache-heavy execution totals after %s and replay",
  async (status) => {
    const folder = await mkdtemp(path.join(tmpdir(), "codex-request-usage-"));
    const file = path.join(folder, "usage.sqlite");
    const at = Date.parse(metadata.occurredAt);
    const { driver, conversation } = codexSdkFixture();
    const ledger = new UsageLedger(file, () => at + 10000);
    await ledger.load();
    const usage = new UsageService(ledger, () => sdkAgent());
    const unsubscribe = driver.onUsage((event) => usage.observe(event));
    const server = new AppBackendServer({
      version: "test",
      snapshot: createTestSnapshot(),
      usage,
    });
    const query = () =>
      server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "usage/get",
        params: {},
      });
    const requestUsage = {
      status: "unavailable",
      reason: "public-runtime-request-evidence-unavailable",
      unavailableFields: [
        "requestIdentity",
        "timestamp",
        "actualModel",
        "actualProvider",
        "requestTokenUsage",
        "cacheWriteLifetimes",
        "cacheWriteInputInclusion",
        "pricingContext",
        "requestedModel",
        "requestedServiceTier",
        "reportedServiceTier",
        "finality",
      ],
      requests: null,
    } as const;
    const counts = {
      totalTokens: 11000,
      inputTokens: 10000,
      cachedInputTokens: 8000,
      cacheWriteInputTokens: null,
      outputTokens: 1000,
      reasoningOutputTokens: 200,
    };
    const projection = {
      observedStart: true,
      last: counts,
      total: counts,
      execution: counts,
      model: null,
      ...{ requestUsage },
    } satisfies import("@codex-app-sdk/core/surface").CodexSurfaceExecutionUsage;
    try {
      await driver.loadConversation(sdkAgent());
      const c = conversation("conversation-a");
      c.setSnapshot({
        selectedModelId: "gpt-6-sol",
        selectedServiceTier: "priority",
      });
      c.emit({
        ...metadata,
        type: "turn.started",
        payload: { startedAt: metadata.occurredAt },
      });
      const sample = {
        ...metadata,
        type: "conversation.executionUsageChanged",
        payload: { usage: projection },
      } as const;
      c.emit(sample);
      c.emit(sample); // cumulative replacement, not two measured requests
      c.emit({
        ...metadata,
        type: "turn.modelRerouted",
        payload: {
          fromModel: "gpt-6-sol",
          toModel: "gpt-6.1",
          reason: "highRiskCyberActivity",
        },
      });
      c.emit({
        ...metadata,
        type: "turn.completed",
        payload: {
          status,
          error: null,
          willRetry: false,
          startedAt: metadata.occurredAt,
          completedAt: metadata.occurredAt,
          durationMs: 100,
          executionUsage: projection,
        },
      });
      c.emit(sample); // terminal usage and reconnect replay must not double-charge
      c.emit({
        ...sample,
        origin: "lifecycle",
        payload: {
          usage: { ...projection, observedStart: false, execution: null },
        },
      });
      const result = await query();
      const summary = (result as { result: UsageSummary }).result;
      expect(summary.cost).toStrictEqual({
        usd: null,
        coverage: "unavailable",
        requests: 0,
        pricedRequests: 0,
        unpricedRequests: 0,
        unknownRequestExecutions: 1,
        reasons: [
          { reason: "public-runtime-request-evidence-unavailable", count: 1 },
        ],
      });
      expect(summary.rows[0]).toMatchObject({
        started: 1,
        [status]: 1,
        measuredTurns: 1,
        tokens: {
          total: 11000,
          input: 10000,
          cacheRead: 8000,
          cacheWrite: null,
          output: 1000,
          reasoning: 200,
        },
      });
      await usage.drain();
      await ledger.close();
      const reopened = new UsageLedger(file, () => at + 10000);
      try {
        await reopened.load();
        expect(reopened.query()).toStrictEqual(summary);
      } finally {
        await reopened.close();
      }
    } finally {
      unsubscribe();
      await server.close();
      await driver.close();
      await rm(folder, { force: true, recursive: true });
    }
  },
);

it("distinguishes older SDK support from incompatible request contracts without deriving billing evidence from selected settings", async () => {
  const { driver, conversation } = codexSdkFixture();
  const at = Date.parse(metadata.occurredAt);
  const ledger = new UsageLedger(":memory:", () => at + 10000);
  await ledger.load();
  const usage = new UsageService(ledger, () => sdkAgent());
  const unsub = driver.onUsage((event) => usage.observe(event));
  try {
    await driver.loadConversation(sdkAgent());
    const c = conversation("conversation-a");
    c.setSnapshot({
      selectedModelId: "gpt-6-sol",
      selectedServiceTier: "priority",
    });
    const count = {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    for (const [turnId, requestUsage] of [
      ["old", undefined],
      [
        "incompatible",
        {
          status: "supported",
          requests: [{ model: "gpt-6-sol", input: 10000 }],
        },
      ],
      [
        "malformed",
        {
          status: "unavailable",
          reason: "public-runtime-request-evidence-unavailable",
          requests: [],
          unavailableFields: ["invented"],
        },
      ],
    ] as const) {
      c.emit({
        ...metadata,
        turnId,
        type: "turn.started",
        payload: { startedAt: metadata.occurredAt },
      });
      // An intentionally malformed external payload must fail at the adapter boundary.
      c.emit({
        ...metadata,
        turnId,
        type: "conversation.executionUsageChanged",
        payload: {
          usage: {
            observedStart: true,
            last: count,
            total: count,
            execution: count,
            model: null,
            requestUsage,
          },
        },
      } as unknown as CodexConversationEvent);
    }
    await usage.drain();
    expect(ledger.query().cost).toStrictEqual({
      usd: null,
      coverage: "unavailable",
      requests: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
      unknownRequestExecutions: 3,
      reasons: [
        { reason: "incompatible-sdk-request-evidence", count: 2 },
        { reason: "missing-sdk-request-evidence", count: 1 },
      ],
    });
    expect(ledger.query().rows[0]).toMatchObject({
      started: 3,
      measuredTurns: 3,
      tokens: { total: 0, cacheRead: 0, cacheWrite: 0 },
    });
  } finally {
    unsub();
    await driver.close();
    await usage.close();
  }
});
