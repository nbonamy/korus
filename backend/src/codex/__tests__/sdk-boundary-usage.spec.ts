import { expect, it } from "vitest";
import type { CodexConversationEvent } from "@codex-app-sdk/core/surface";
import type { ExecutionObservation } from "@workspace/core/usage";
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
    c.setSnapshot({ selectedReasoningEffort: "high", selectedServiceTier: "fast" });
    c.emit({
      ...metadata,
      type: "turn.started",
      payload: { startedAt: metadata.occurredAt },
    } as CodexConversationEvent);
    expect(observations[0]).toMatchObject({ reasoningEffort: "high", serviceTier: "fast" });
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
    expect(observations[0]).toMatchObject({ reasoningEffort: null, serviceTier: "normal" });
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
