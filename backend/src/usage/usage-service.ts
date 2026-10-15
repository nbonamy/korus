import type { Agent, MainToRendererEvent } from "@workspace/core/contracts";
import type { ExecutionObservation } from "@workspace/core/usage";
import { UsageLedger } from "./usage-ledger";
import { TurnClock } from "./turn-clock";
import { providerConversationEventView } from "@workspace/core/provider-conversation-event";
/** Tool calls an event reports as running or finished, however the provider surfaces them. */
function toolStates(view: {
  type: string;
  payload?: unknown;
}): [string, boolean][] {
  const payload = (view.payload ?? {}) as Record<string, any>;
  const state = (part: {
    id?: unknown;
    status?: unknown;
  }): [string, boolean][] =>
    typeof part?.id === "string" && typeof part.status === "string"
      ? [[part.id, part.status === "running"]]
      : [];
  if (view.type === "tool.started" || view.type === "tool.completed")
    return state(payload.toolPart ?? {});
  if (view.type === "tool.updated") {
    const update = payload.update ?? {};
    return typeof update.itemId === "string" &&
      typeof update.status === "string"
      ? [[update.itemId, update.status === "running"]]
      : [];
  }
  const parts = payload.message?.parts;
  return Array.isArray(parts)
    ? parts.flatMap((part) => (part?.type === "tool" ? state(part) : []))
    : [];
}
/** Records numeric observations in the owning daemon's local ledger. */
export class UsageService {
  private chain: Promise<void> = Promise.resolve();
  private executions = new Set<string>();
  private submitted = new Map<string, { at: number; wall: number }>();
  constructor(
    readonly local: UsageLedger,
    private readonly agent: (id: string) => Agent | undefined,
    private readonly clock: TurnClock = new TurnClock(),
    private readonly now: () => number = () => performance.now(),
  ) {}
  /** Feeds the turn clock from the one stream every provider's events pass through. */
  observeEvent(event: MainToRendererEvent): void {
    const agentId = event.agentId;
    if (!agentId) return;
    if (event.type === "agent.statusChanged") {
      const status = (event.payload as { type?: string }).type;
      if (status === "awaitingInput") this.clock.wait(agentId, true);
      else if (status === "working") this.clock.wait(agentId, false);
      return;
    }
    const view = providerConversationEventView(event);
    if (
      view.type === "message.delta" ||
      view.type === "plan.delta" ||
      view.type === "tool.started"
    )
      this.clock.output(agentId);
    for (const [id, running] of toolStates(view))
      this.clock.tool(agentId, id, running);
  }
  beginPrompt(agentId: string): object | null {
    const agent = this.agent(agentId);
    if (agent && !["idle", "error"].includes(agent.status.type)) return null;
    const submission = { at: this.now(), wall: Date.now() };
    this.submitted.set(agentId, submission);
    while (this.submitted.size > 10000)
      this.submitted.delete(this.submitted.keys().next().value!);
    return submission;
  }
  cancelPrompt(agentId: string, submission: object | null | undefined): void {
    if (this.submitted.get(agentId) === submission) this.submitted.delete(agentId);
  }
  observe(event: ExecutionObservation): void {
    const key = JSON.stringify([event.provider, event.sessionId, event.turnId]);
    if (event.phase === "started" && !this.executions.has(key)) {
      // The clock starts at prompt submission, falling back to the first observation.
      const submitted = this.submitted.get(event.agentId);
      this.clock.start(
        event.agentId,
        submitted && Date.now() - submitted.wall < 60000
          ? submitted.at
          : this.now(),
      );
      this.submitted.delete(event.agentId);
      this.executions.add(key);
      while (this.executions.size > 10000)
        this.executions.delete(this.executions.values().next().value!);
    }
    if (event.phase !== "started" && event.phase !== "usage") {
      this.executions.delete(key);
      const timing = this.clock.finish(event.agentId);
      if (timing) event = { ...event, timing };
    }
    const agent = this.agent(event.agentId);
    this.chain = this.chain
      .then(async () => {
        await this.local.observe(event, {
          teamId: agent?.teamId ?? null,
          repository: agent?.folder ?? null,
        });
      })
      .catch(() => undefined);
  }
  clear(): Promise<void> {
    const clearing = this.chain.then(() => this.local.clear());
    this.chain = clearing.catch(() => undefined);
    return clearing;
  }
  async drain(): Promise<void> {
    await this.chain;
  }
  async close(): Promise<void> {
    await this.chain;
    await this.local.close();
  }
}
