import type { Agent, BackendPublishedEvent } from "@workspace/core/contracts";
import type {
  ExecutionObservation,
  RequestObservation,
} from "@workspace/core/usage";
import { UsageLedger } from "./usage-ledger";
import { TurnClock } from "./turn-clock";
import {
  validTelemetryPreviewInput,
  normalizeTelemetryVersion,
  serializeDailyTelemetry,
  telemetryOs,
  type TelemetryPreviewInput,
  type SealedTelemetryBody,
} from "@workspace/core/telemetry";
import { repositoryIdentityOf, resolveRepositoryRoots } from "./repository-identity";
/** Tool calls an event reports as running or finished, however the provider surfaces them. */
/** Records numeric observations in the owning daemon's local ledger. */
export class UsageService {
  private chain: Promise<void> = Promise.resolve();
  private executions = new Map<string, string>();
  private submitted = new Map<string, { at: number; wall: number }>();
  constructor(
    readonly local: UsageLedger,
    private readonly agent: (id: string) => Agent | undefined,
    private readonly clock: TurnClock = new TurnClock(),
    private readonly now: () => number = () => performance.now(),
    private readonly agents: () => readonly Agent[] = () => [],
  ) {}
  /** Feeds the turn clock from the one stream every provider's events pass through. */
  observeEvent(event: BackendPublishedEvent): void {
    const agentId = event.agentId;
    if (!agentId) return;
    if (event.type === "agent.statusChanged") {
      const status = event.payload.type;
      if (status === "awaitingInput") this.clock.wait(agentId, true);
      else if (status === "working") this.clock.wait(agentId, false);
      return;
    }
    if (event.type === "turn.output") this.clock.output(agentId);
    if (event.type === "tool.updated") this.clock.tool(agentId, event.payload.tool.id, event.payload.tool.status === "running");
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
    if (this.submitted.get(agentId) === submission)
      this.submitted.delete(agentId);
  }
  observe(event: ExecutionObservation): void {
    const key = JSON.stringify([event.provider, event.sessionId, event.turnId]);
    if (event.generation) {
      if (this.executions.get(event.agentId) === key) {
        if (event.generation === "output") this.clock.output(event.agentId);
        else this.clock.generation(event.agentId, event.generation === "started");
      }
      return;
    }
    if (event.phase === "started" && !this.executions.has(event.agentId)) {
      // The clock starts at prompt submission, falling back to the first observation.
      const submitted = this.submitted.get(event.agentId);
      this.clock.start(
        event.agentId,
        submitted && Date.now() - submitted.wall < 60000
          ? submitted.at
          : this.now(),
      );
      this.submitted.delete(event.agentId);
      this.executions.set(event.agentId, key);
      while (this.executions.size > 10000)
        this.executions.delete(this.executions.keys().next().value!);
    }
    if (
      event.phase !== "started" &&
      event.phase !== "usage" &&
      this.executions.get(event.agentId) === key
    ) {
      this.executions.delete(event.agentId);
      const taskDurationMs = this.clock.taskDurationMs(event.agentId);
      const timing = this.clock.finish(event.agentId);
      if (taskDurationMs !== null) event = { ...event, taskDurationMs };
      if (timing) event = { ...event, timing };
    }
    const agent = this.agent(event.agentId);
    this.chain = this.chain
      .then(async () => {
        await this.local.observe(event, {
          teamId: agent?.teamId ?? null,
          repository: repositoryIdentityOf(agent),
        });
      })
      .catch(() => undefined);
  }
  /** Re-files turns recorded before the repository was tracked under their repository; runs once. */
  migrateRepositories(resolve: (folders: string[]) => Promise<Map<string, string>> = folders => resolveRepositoryRoots(folders, this.agents())): Promise<void> {
    const migration = this.chain.then(() => this.local.migrateRepositories(resolve));
    this.chain = migration.catch(() => undefined);
    return migration.catch(() => undefined);
  }
  observeRequest(event: RequestObservation): void {
    this.chain = this.chain
      .then(async () => {
        await this.local.observeRequest(event);
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
  /** Retained UTC buckets with local ledger observations. */
  async telemetryHours() {
    await this.drain();
    return this.local.telemetryHours();
  }
  /** Local-only projection; the caller supplies identity and the UTC reporting bucket. */
  async previewTelemetry(
    input: TelemetryPreviewInput,
    version: string,
    platform: string,
    from = 0,
  ): Promise<SealedTelemetryBody> {
    if (!validTelemetryPreviewInput(input))
      throw new Error("Invalid telemetry preview.");
    await this.drain();
    const { day, hour } = input;
    return serializeDailyTelemetry({
      installId: input.installId,
      day,
      ...(hour !== undefined ? {hour} : {}),
      appVersion: normalizeTelemetryVersion(version),
      os: telemetryOs(platform),
      usage: this.local.projectDailyTelemetry({
        day,
        ...(hour !== undefined ? {hour} : {}),
      }, from),
    });
  }
  async close(): Promise<void> {
    await this.chain;
    await this.local.close();
  }
}

