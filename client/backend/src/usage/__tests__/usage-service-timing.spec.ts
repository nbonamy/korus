import { expect, it } from "vitest";
import type { Agent, MainToRendererEvent } from "@workspace/core/contracts";
import { TurnClock } from "../turn-clock";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";

it("records a turn's real working time from backend events, not from the provider's driver", async () => {
  const local = new UsageLedger(":memory:");
  await local.load();
  let now = 0;
  const service = new UsageService(
    local,
    () =>
      ({
        id: "a",
        teamId: "t",
        folder: "/repo",
        status: { type: "working" },
      }) as unknown as Agent,
    new TurnClock(() => now),
    () => now,
  );
  const base = {
    agentId: "a",
    sessionId: "s",
    turnId: "t1",
    provider: "codex" as const,
    model: "m",
  };
  const event = (type: string, payload: unknown = {}) =>
    ({ agentId: "a", type, payload }) as unknown as MainToRendererEvent;
  try {
    service.observe({ ...base, phase: "started", at: Date.now() });
    now = 1000;
    service.observeEvent(
      event("agent.statusChanged", { type: "awaitingInput" }),
    );
    now = 31000; // Thirty seconds waiting on an approval.
    service.observeEvent(event("agent.statusChanged", { type: "working" }));
    now = 32000;
    service.observeEvent(
      event("codex.conversationEventReceived", {
        event: { type: "message.delta", payload: {} },
      }),
    );
    // Two tools in parallel, including a status update on an existing tool.
    now = 33000;
    service.observeEvent(
      event("codex.conversationEventReceived", {
        event: {
          type: "tool.started",
          payload: { toolPart: { id: "a", status: "running" } },
        },
      }),
    );
    service.observeEvent(
      event("codex.conversationEventReceived", {
        event: {
          type: "tool.started",
          payload: { toolPart: { id: "b", status: "running" } },
        },
      }),
    );
    now = 35000;
    service.observeEvent(
      event("codex.conversationEventReceived", {
        event: {
          type: "tool.completed",
          payload: { toolPart: { id: "a", status: "completed" } },
        },
      }),
    );
    now = 38000;
    service.observeEvent(
      event("codex.conversationEventReceived", {
        event: {
          type: "tool.updated",
          payload: { update: { itemId: "b", status: "completed" } },
        },
      }),
    );
    now = 42000;
    service.observe({
      ...base,
      phase: "completed",
      at: Date.now(),
      tokens: {
        input: 500,
        output: 100,
        cacheRead: 0,
        cacheWrite: null,
        total: 600,
      },
    });
    await service.drain();
    expect(local.query({ group: "provider" }).rows[0]).toMatchObject({
      speed: {
        turns: 1,
        outputTokens: 100,
        generationMs: 5000,
        ttftMs: 2000,
        ttftTurns: 1,
      },
    });
  } finally {
    await service.close();
  }
});
