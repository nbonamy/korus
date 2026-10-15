import type {
  Agent,
  AppSnapshot,
  MainToRendererEvent,
} from "@workspace/core/contracts";
import type { ExecutionObservation } from "@workspace/core/usage";
import { TelemetryReporter, type ObservationOrigin } from "./reporter";
import type { ClientFeature } from "@workspace/core/telemetry";
import { UsageLedger } from "./usage-ledger";
import { TurnClock } from "./turn-clock";
import { providerConversationEventView } from "@workspace/core/provider-conversation-event";
import type { FeatureReporter } from "./feature-reporter";
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
/** One owner records; observers and remote history never feed this service. */
export class UsageService {
  private chain: Promise<void> = Promise.resolve();
  private sources = new Map<
    string,
    { source: string; permission: number | null; at: number }
  >();
  private executions = new Map<
    string,
    { source: string; permission: number | null; agentId: string }
  >();
  private outcomes = new Map<
    string,
    {
      source: string;
      permission: number | null;
      feature: "mission.finish" | "automation.finish";
    }
  >();
  outcomeKeys(kind: "mission" | "automation", snapshot: AppSnapshot): string[] {
    return kind === "mission"
      ? (snapshot.missions ?? []).flatMap((m) =>
          (m.execution?.runs ?? []).map((r) => "mission:" + r.id),
        )
      : snapshot.automations.flatMap((a) =>
          a.executionLog.map((r) => "automation:" + r.id),
        );
  }
  trackOutcomes(
    kind: "mission" | "automation",
    before: string[],
    snapshot: AppSnapshot,
    source: string,
    permission: number | null,
  ): void {
    if (permission === null) return;
    for (const key of this.outcomeKeys(kind, snapshot))
      if (!before.includes(key))
        this.outcomes.set(key, {
          source,
          permission,
          feature: kind === "mission" ? "mission.finish" : "automation.finish",
        });
    while (this.outcomes.size > 10000)
      this.outcomes.delete(this.outcomes.keys().next().value!);
    this.observeSnapshot(snapshot);
  }
  observeSnapshot(snapshot: AppSnapshot): void {
    if (!this.outcomes.size) return;
    const states = new Map<string, string>();
    for (const mission of snapshot.missions ?? [])
      for (const run of mission.execution?.runs ?? [])
        states.set("mission:" + run.id, run.status);
    for (const automation of snapshot.automations)
      for (const run of automation.executionLog)
        states.set("automation:" + run.id, run.status);
    for (const [key, operation] of this.outcomes) {
      const status = states.get(key);
      if (
        status &&
        [
          "completed",
          "awaitingReview",
          "accepted",
          "failed",
          "cancelled",
        ].includes(status)
      ) {
        this.outcomes.delete(key);
        this.chain = this.chain
          .then(() =>
            this.telemetry.feature(
              operation.source,
              key,
              operation.feature,
              ["completed", "awaitingReview", "accepted"].includes(status)
                ? "succeeded"
                : status === "cancelled"
                  ? "cancelled"
                  : "failed",
              operation.permission,
            ),
          )
          .catch(() => undefined);
      } else if (!status) this.outcomes.delete(key);
    }
  }
  /** When each agent's latest prompt was submitted, on the turn clock's timeline. */
  private submitted = new Map<string, { at: number; wall: number }>();
  constructor(
    readonly local: UsageLedger,
    readonly telemetry: TelemetryReporter,
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
  source(agentId: string, clientId: string): object | null {
    const agent = this.agent(agentId);
    if (agent && !["idle", "error"].includes(agent.status.type)) return null;
    const source = {
      source: clientId,
      permission: this.telemetry.permission(clientId),
      at: Date.now(),
    };
    // Concurrent/queued requests without provider-owned origin evidence are ambiguous and fail closed.
    if (this.sources.has(agentId)) source.permission = null;
    this.sources.set(agentId, source);
    this.submitted.set(agentId, { at: this.now(), wall: Date.now() });
    while (this.sources.size > 10000)
      this.sources.delete(this.sources.keys().next().value!);
    return source;
  }
  cancelSource(agentId: string, source: object | null | undefined): void {
    if (this.sources.get(agentId) !== source) return;
    this.sources.delete(agentId);
    this.submitted.delete(agentId);
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
      const arm = this.sources.get(event.agentId);
      this.executions.set(key, {
        ...(arm && arm.at > Date.now() - 60000
          ? arm
          : { source: "unknown", permission: null }),
        agentId: event.agentId,
      });
      this.sources.delete(event.agentId);
      while (this.executions.size > 10000)
        this.executions.delete(this.executions.keys().next().value!);
    }
    const source = this.executions.get(key) ?? {
      source: "unknown",
      permission: null,
    };
    if (event.phase !== "started" && event.phase !== "usage") {
      this.executions.delete(key);
      const timing = this.clock.finish(event.agentId);
      if (timing) event = { ...event, timing };
    }
    const agent = this.agent(event.agentId);
    this.chain = this.chain
      .then(async () => {
        if (
          await this.local.observe(event, {
            teamId: agent?.teamId ?? null,
            repository: agent?.folder ?? null,
          })
        )
          await this.telemetry.execution(
            event,
            source.source,
            source.permission,
          );
      })
      .catch(() => undefined);
  }
  /** MCP operations inherit only an unambiguous live execution's originating permission. */
  private executionOrigin(agentId: string): ObservationOrigin | null {
    const owners = [...this.executions.values()].filter(
      (execution) => execution.agentId === agentId,
    );
    const owner = owners.length === 1 ? owners[0] : undefined;
    return owner &&
      owner.permission !== null &&
      owner.permission === this.telemetry.permission(owner.source)
      ? owner
      : null;
  }
  featuresForAgent(agentId: string): FeatureReporter {
    return this.telemetry.forSource(
      this.executionOrigin(agentId)?.source ?? "remote-unsynchronized",
    );
  }
  beginClientFeature(
    clientId: string,
    feature: ClientFeature,
    agentId?: string,
  ): Promise<string | null> {
    return this.telemetry.beginFeature(
      clientId,
      feature,
      agentId === undefined ? undefined : this.executionOrigin(agentId),
    );
  }
  clear(): Promise<void> {
    const clearing = this.chain.then(() => this.local.clear());
    this.chain = clearing.catch(() => undefined);
    return clearing;
  }
  async drain(): Promise<void> {
    await this.chain;
    await this.telemetry.drain();
  }
  async close(): Promise<void> {
    await this.chain;
    await this.telemetry.close();
    await this.local.close();
  }
}
