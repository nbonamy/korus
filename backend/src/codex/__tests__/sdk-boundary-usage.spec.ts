import { expect, it, vi } from "vitest";
import type { CodexConversationEvent } from "@codex-app-sdk/core/surface";
import type { ExecutionObservation, AccountUsage } from "@workspace/core/usage";
import { codexSdkFixture, sdkAgent } from "./sdk-surface-fixture";
const metadata = {
  seq: 1,
  origin: "notification" as const,
  occurredAt: "2026-10-11T00:00:00Z",
  conversationId: "conversation-a",
  turnId: "turn-a",
};
it("uses only SDK-owner live replacements, ignores replay/occupancy, and preserves nullable cache write and actual-model unknown", async () => {
  const { driver, conversation } = codexSdkFixture();
  const observations: ExecutionObservation[] = [];
  driver.onUsage((e) => observations.push(e));
  try {
    await driver.loadConversation(sdkAgent());
    expect(observations).toStrictEqual([]);
    const c = conversation("conversation-a");
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
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
      "completed",
      "usage",
    ]);
  } finally {
    await driver.close();
  }
});
it("reads account-wide usage only on explicit request, keeps decimal strings exact, and returns unknown with older SDKs", async () => {
  const { driver, surface } = codexSdkFixture();
  const account: AccountUsage = {
    summary: {
      lifetimeTokens: "90071992547409931234",
      peakDailyTokens: null,
      longestRunningTurnSec: null,
      currentStreakDays: "1",
      longestStreakDays: "2",
    },
    dailyUsageBuckets: [
      { startDate: "2026-10-10", tokens: "90071992547409931234" },
    ],
  };
  let reads = 0;
  try {
    expect(await driver.getAccountUsage()).toBeNull();
    Object.assign(surface, {
      readAccountUsage: async () => {
        reads++;
        return account;
      },
    });
    await driver.loadConversation(sdkAgent());
    expect(reads).toBe(0);
    expect(await driver.getAccountUsage()).toStrictEqual(account);
    expect(reads).toBe(1);
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

it("counts the union of live semantic tool IDs, including completion-only tools, without grouping them into model responses", async () => {
  const { driver, conversation } = codexSdkFixture();
  const observations: ExecutionObservation[] = [];
  driver.onUsage((o) => observations.push(o));
  try {
    await driver.loadConversation(sdkAgent());
    const c = conversation("conversation-a");
    const tool = (type: string, id: string) =>
      c.emit({
        ...metadata,
        type,
        payload: {
          toolPart: {
            id,
            kind: "command",
            title: "CANARY command",
            status: "completed",
          },
        },
      } as unknown as CodexConversationEvent);
    tool("tool.completed", "historical");
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
    tool("tool.started", "a");
    tool("tool.completed", "a");
    tool("tool.completed", "b");
    tool("tool.updated", "a");
    c.emit({
      ...metadata,
      type: "turn.completed",
      payload: {
        status: "completed",
        durationMs: 100,
        error: null,
        willRetry: false,
        startedAt: metadata.occurredAt,
        completedAt: metadata.occurredAt,
      },
    } as CodexConversationEvent);
    tool("tool.completed", "late");
    expect(observations).toHaveLength(2);
    expect(observations[1]!.behavior).toStrictEqual({
      model: null,
      responses: null,
      toolCalls: 2,
      toolResponses: null,
      multiToolResponses: null,
      stream: null,
    });
    expect(JSON.stringify(observations)).not.toContain("CANARY");
  } finally {
    await driver.close();
  }
});

it("counts only new live text deltas from an observed execution and emits numeric delivery timing without text or model inference", async () => {
  const { driver, conversation } = codexSdkFixture();
  const observations: ExecutionObservation[] = [];
  driver.onUsage((e) => observations.push(e));
  const clock = vi.spyOn(performance, "now");
  let now = 100;
  clock.mockImplementation(() => now);
  try {
    await driver.loadConversation(sdkAgent());
    const c = conversation("conversation-a");
    const delta = (seq: number, text: string, origin = "notification") =>
      c.emit({
        ...metadata,
        type: "message.delta",
        seq,
        origin,
        payload: { messageId: "m", itemId: "i", delta: text },
      } as CodexConversationEvent);
    delta(1, "CONTENT_CANARY before start");
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
    delta(2, "CONTENT_CANARY first");
    now = 1100;
    delta(3, "hello");
    delta(3, "CONTENT_CANARY duplicate");
    delta(4, "CONTENT_CANARY replay", "lifecycle");
    c.emit({
      ...metadata,
      type: "turn.completed",
      seq: 5,
      payload: {
        status: "completed",
        durationMs: 1000,
        error: null,
        willRetry: false,
        startedAt: metadata.occurredAt,
        completedAt: metadata.occurredAt,
      },
    } as CodexConversationEvent);
    expect(observations).toHaveLength(2);
    expect(observations[1]).toMatchObject({
      textStream: { characters: 5, durationMs: 1000, messages: 1 },
      model: null,
    });
    expect(JSON.stringify(observations)).not.toContain("CONTENT_CANARY");
  } finally {
    clock.mockRestore();
    await driver.close();
  }
});
