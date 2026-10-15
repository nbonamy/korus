import { expect, it } from "vitest";
import type { Agent } from "@workspace/core/contracts";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";
import { TurnClock } from "../turn-clock";

it("ignores a previous turn's duplicate completion while timing the next turn", async () => {
  const local = new UsageLedger(":memory:");
  let now = 0;
  const usage = new UsageService(
    local,
    () => undefined,
    new TurnClock(() => now),
    () => now,
  );
  const event = {
    provider: "claude" as const,
    model: "model",
    agentId: "a",
    sessionId: "s",
    at: Date.now(),
  };
  try {
    await local.load();
    usage.observe({ ...event, turnId: "old", phase: "started" });
    now = 100;
    usage.observe({ ...event, turnId: "old", phase: "completed" });
    now = 200;
    usage.observe({ ...event, turnId: "new", phase: "started" });
    now = 300;
    usage.observe({ ...event, turnId: "old", phase: "completed" });
    now = 400;
    usage.observeEvent({
      agentId: "a",
      type: "claude.conversationEventReceived",
      payload: { event: { type: "message.delta", payload: {} } },
    } as never);
    now = 500;
    usage.observe({
      ...event,
      turnId: "new",
      phase: "completed",
      tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: null },
    });
    await usage.drain();
    expect(local.query().rows[0]?.speed).toStrictEqual({
      turns: 1,
      outputTokens: 20,
      generationMs: 100,
      ttftMs: 200,
      ttftTurns: 1,
    });
  } finally {
    await usage.close();
  }
});

it("preserves the latest prompt timing when an earlier submission fails", async () => {
  const local = new UsageLedger(":memory:");
  const agent = {
    id: "a",
    teamId: "team",
    folder: "/repo",
    status: { type: "idle" },
  } as Agent;
  let now = 1000;
  const usage = new UsageService(
    local,
    () => agent,
    new TurnClock(() => now),
    () => now,
  );
  const event = {
    provider: "claude" as const,
    model: "model",
    agentId: "a",
    sessionId: "s",
    turnId: "t",
    at: Date.now(),
  };
  try {
    await local.load();
    const rejected = usage.beginPrompt("a");
    now = 2000;
    usage.beginPrompt("a");
    usage.cancelPrompt("a", rejected);
    now = 4000;
    usage.observe({ ...event, phase: "started" });
    agent.status = { type: "working" };
    expect(usage.beginPrompt("a")).toBeNull();
    now = 5000;
    usage.observeEvent({
      agentId: "a",
      type: "claude.conversationEventReceived",
      payload: { event: { type: "message.delta", payload: {} } },
    } as never);
    now = 7000;
    usage.observe({
      ...event,
      phase: "completed",
      tokens: { input: 1, output: 20, cacheRead: 0, cacheWrite: null },
    });
    await usage.drain();
    expect(local.query().rows[0]?.speed).toStrictEqual({
      turns: 1,
      outputTokens: 20,
      generationMs: 2000,
      ttftMs: 3000,
      ttftTurns: 1,
    });
  } finally {
    await usage.close();
  }
});
