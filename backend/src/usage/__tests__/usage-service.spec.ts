import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { Agent } from "@workspace/core/contracts";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";
import { TurnClock } from "../turn-clock";

it("preserves the latest prompt timing when an earlier submission fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "usage-submission-"));
  const local = new UsageLedger(path.join(dir, "usage.sqlite"));
  const agent = { id: "a", teamId: "team", folder: "/repo", status: { type: "idle" } } as Agent;
  let now = 1000;
  const usage = new UsageService(local, () => agent, new TurnClock(() => now), () => now);
  const event = { provider: "claude" as const, model: "model", agentId: "a", sessionId: "s", turnId: "t", at: Date.now() };
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
    usage.observeEvent({ agentId: "a", type: "claude.conversationEventReceived", payload: { event: { type: "message.delta", payload: {} } } } as never);
    now = 7000;
    usage.observe({ ...event, phase: "completed", tokens: { input: 1, output: 20, cacheRead: 0, cacheWrite: null } });
    await usage.drain();
    expect(local.query().rows[0]?.speed).toStrictEqual({ turns: 1, outputTokens: 20, generationMs: 2000, ttftMs: 3000, ttftTurns: 1 });
  } finally {
    await usage.close();
    await rm(dir, { recursive: true, force: true });
  }
});
