import type { Agent, AppSnapshot } from "@workspace/core/contracts";
import type { ExecutionObservation } from "@workspace/core/usage";
import { TelemetryReporter } from "./reporter";
import { UsageLedger } from "./usage-ledger";
/** One owner records; observers and remote history never feed this service. */
export class UsageService {
  private chain: Promise<void> = Promise.resolve();
  private sources = new Map<
    string,
    { source: string; permission: number | null; at: number }
  >();
  private executions = new Map<
    string,
    { source: string; permission: number | null }
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
  constructor(
    readonly local: UsageLedger,
    readonly telemetry: TelemetryReporter,
    private readonly agent: (id: string) => Agent | undefined,
  ) {}
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
    while (this.sources.size > 10000)
      this.sources.delete(this.sources.keys().next().value!);
    return source;
  }
  cancelSource(agentId: string, source: object | null | undefined): void {
    if (this.sources.get(agentId) === source) this.sources.delete(agentId);
  }
  observe(event: ExecutionObservation): void {
    const key = JSON.stringify([event.provider, event.sessionId, event.turnId]);
    if (event.phase === "started" && !this.executions.has(key)) {
      const arm = this.sources.get(event.agentId);
      this.executions.set(
        key,
        arm && arm.at > Date.now() - 60000
          ? arm
          : {
              source: "unknown",
              permission: null,
            },
      );
      this.sources.delete(event.agentId);
      while (this.executions.size > 10000)
        this.executions.delete(this.executions.keys().next().value!);
    }
    const source = this.executions.get(key) ?? {
      source: "unknown",
      permission: null,
    };
    if (event.phase !== "started" && event.phase !== "usage")
      this.executions.delete(key);
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
