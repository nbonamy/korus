import { randomUUID, createHash } from "node:crypto";
import {
  clientFeatures,
  telemetryFeatures,
  telemetryDisclosureVersion,
  isTelemetryChoice,
  isTelemetryReport,
  publicModel,
  telemetryLimits,
  utcDay,
  type TelemetryChoice,
  type TelemetryPrivacy,
  type TelemetryReport,
  type TelemetryRow,
  type TelemetryFeature,
  type ClientFeature,
  type FeatureOutcome,
} from "@workspace/core/telemetry";
import type { ExecutionObservation } from "@workspace/core/usage";
import { JsonStore } from "./json-store";
import type { FeatureReporter, FeatureCompletion } from "./feature-reporter";
type Batch = {
  report: TelemetryReport;
  created: number;
  next: number;
  attempts: number;
  sealed: boolean;
};
type State = {
  choices: Record<string, TelemetryChoice>;
  queue: Batch[];
  seen: { id: string; at: number }[];
};
/** Local ownership only; never serialized into a report. */
export type ObservationOrigin = { source: string; permission: number | null };
export type ReporterConfig = {
  forceOff: boolean;
  environment: boolean;
  endpoint: string | null;
  synthetic?: boolean;
  immediate?: boolean;
  version: string;
  channel: TelemetryReport["channel"];
  platform: "macos" | "windows" | "linux";
  client: "desktop" | "web" | "mobile" | "daemon";
};
export class TelemetryReporter {
  private state: State = { choices: {}, queue: [], seen: [] };
  private generation = 0;
  private observations: Promise<void> = Promise.resolve();
  private observationCount = 0;
  private controller: AbortController | null = null;
  private closed = false;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private started = false;
  private eligible = new Map<string, string>();
  private operations = new Map<
    string,
    {
      source: string;
      reportingSource: string;
      feature: ClientFeature;
      permission: number;
      at: number;
    }
  >();
  private readonly store: JsonStore<State>;
  constructor(
    file: string,
    private readonly config: ReporterConfig,
    private readonly now: () => number = Date.now,
    private readonly deliver: typeof fetch = fetch,
    private readonly random: () => number = Math.random,
  ) {
    this.store = new JsonStore(file, telemetryLimits.queueBytes);
    try {
      if (config.endpoint) {
        const url = new URL(config.endpoint);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !(
            url.protocol === "https:" ||
            (config.synthetic &&
              url.protocol === "http:" &&
              ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
          )
        )
          this.closed = true;
      }
    } catch {
      this.closed = true;
    }
  }
  async load(): Promise<void> {
    const data = (await this.store.read()) as State | null;
    if (data && typeof data.choices === "object" && data.choices)
      this.state.choices = Object.fromEntries(
        Object.entries(data.choices)
          .filter(([id, c]) => id.length <= 200 && isTelemetryChoice(c))
          .slice(-100),
      );
    // Restarted queue is trusted only under an active configured gate and persisted disclosure.
    if (
      this.baseAllowed() &&
      this.state.choices.desktop?.enabled === true &&
      Array.isArray(data?.queue)
    )
      this.state.queue = data.queue
        .filter(
          (b) =>
            isTelemetryReport(b?.report) &&
            (b.report.family !== "behavior" ||
              this.state.choices.desktop?.disclosure ===
                telemetryDisclosureVersion) &&
            Number.isFinite(b.created) &&
            Number.isFinite(b.next) &&
            Number.isSafeInteger(b.attempts) &&
            b.attempts >= 0,
        )
        .map((b) => ({
          ...b,
          next:
            b.attempts === 0
              ? Math.min(
                  b.next,
                  this.now() + (this.config.immediate ? 0 : 300000),
                )
              : b.next,
          sealed: true,
        }));
    if (Array.isArray(data?.seen))
      this.state.seen = data.seen
        .filter(
          (s) =>
            s &&
            typeof s.id === "string" &&
            s.id.length <= 1000 &&
            Number.isFinite(s.at),
        )
        .slice(-10000);
    this.prune();
    try {
      await this.save();
    } catch {
      this.closed = true;
      this.state.queue = [];
    }
  }
  start(): void {
    this.started = true;
    this.schedule();
  }
  private schedule(): void {
    if (!this.started || !this.baseAllowed() || !this.state.queue.length) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    const next = Math.min(...this.state.queue.map((batch) => batch.next));
    const at = Math.max(this.now() + 1000, next);
    // New observations may move delivery earlier, never postpone an existing batch.
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, at - this.now());
    this.timer.unref();
  }
  privacy(source: string): TelemetryPrivacy {
    const choice = this.state.choices[source] ?? null;
    const blocked = this.config.forceOff
      ? "administrator"
      : !this.config.environment
        ? "environment"
        : !this.config.endpoint
          ? "configuration"
          : !choice
            ? "disclosure"
            : null;
    return {
      choice,
      active:
        source !== "remote-unsynchronized" &&
        !this.closed &&
        !blocked &&
        choice?.enabled === true &&
        this.state.choices.desktop?.enabled === true,
      blocked,
      pending: structuredClone(this.state.queue.map((b) => b.report)),
    };
  }
  allowed(source: string): boolean {
    return this.privacy(source).active;
  }
  async choose(
    source: string,
    choice: TelemetryChoice,
  ): Promise<TelemetryPrivacy> {
    if (!isTelemetryChoice(choice) || !source || source.length > 200)
      throw new Error("Invalid privacy choice.");
    this.state.choices[source] = { ...choice };
    // Any permission transition starts fresh, aborting generations already in flight.
    this.generation++;
    this.controller?.abort();
    this.state.queue = [];
    this.eligible.clear();
    this.operations.clear();
    this.schedule();
    try {
      await this.save();
    } catch {
      this.closed = true;
      this.state.queue = [];
      throw new Error("Privacy choice could not be saved.");
    }
    return this.privacy(source);
  }
  async execution(
    event: ExecutionObservation,
    source: string,
    permission: number | null = this.permission(source),
  ): Promise<void> {
    // Codex usage is mutable after terminal and can be invalidated. Anonymous positive-only batches cannot retract it.
    if (event.phase === "usage") return;
    if (permission === null || permission !== this.generation) return;
    const identity = JSON.stringify([
      event.provider,
      event.sessionId,
      event.turnId,
    ]);
    if (event.phase === "started") {
      if (this.allowed(source)) this.eligible.set(identity, source);
    }
    if (!this.allowed(source) || this.eligible.get(identity) !== source) return;
    const rows: TelemetryRow[] = [
      {
        day: utcDay(event.at),
        metric: `turn.${event.phase}`,
        provider: event.provider,
        model: publicModel(event.model),
        value: 1,
      },
    ];
    if (event.provider !== "codex" && event.tokens) {
      rows.push({ ...rows[0]!, metric: "tokens.observed", value: 1 });
      for (const key of [
        "total",
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "reasoning",
      ] as const)
        if (event.tokens[key])
          rows.push({
            ...rows[0]!,
            metric: `tokens.${key}`,
            value: event.tokens[key]!,
          });
    }
    if (event.durationMs !== undefined)
      rows.push({
        ...rows[0]!,
        metric:
          event.durationMs < 10000
            ? "duration.lt10s"
            : event.durationMs < 60000
              ? "duration.lt60s"
              : event.durationMs < 300000
                ? "duration.lt5m"
                : "duration.ge5m",
        value: 1,
      });
    await this.record(source, identity + event.phase, "runtime", rows);
    if (event.phase !== "started") {
      if (
        this.state.choices[source]?.disclosure === telemetryDisclosureVersion &&
        this.state.choices.desktop?.disclosure === telemetryDisclosureVersion
      )
        await this.recordBehavior(event, source, identity);
      this.eligible.delete(identity);
    }
  }
  private async recordBehavior(
    event: ExecutionObservation,
    source: string,
    identity: string,
  ): Promise<void> {
    const behavior = event.behavior;
    // Model behavior requires response-level evidence; initialization/settings alone do not attribute a model.
    const model = publicModel(behavior?.model ?? null);
    const base = { day: utcDay(event.at), provider: event.provider, model };
    const rows: TelemetryRow[] = [];
    const add = (metric: TelemetryRow["metric"], value: number) =>
      rows.push({ ...base, metric, value });
    add("behavior.terminalObserved", 1);
    add("behavior.completed", event.phase === "completed" ? 1 : 0);
    add("behavior.failed", event.phase === "failed" ? 1 : 0);
    add("behavior.interrupted", event.phase === "interrupted" ? 1 : 0);
    if (
      Number.isSafeInteger(event.durationMs) &&
      event.durationMs! >= 0 &&
      event.durationMs! <= 1e9
    ) {
      add("behavior.durationMs", event.durationMs!);
      add("behavior.durationObserved", 1);
    }
    if (behavior?.responses !== null && behavior?.responses !== undefined) {
      add("behavior.responses", behavior.responses);
      add("behavior.responsesObserved", 1);
      if (behavior.toolResponses !== null)
        add("behavior.toolResponses", behavior.toolResponses);
      if (behavior.multiToolResponses !== null)
        add("behavior.multiToolResponses", behavior.multiToolResponses);
    }
    if (behavior?.toolCalls !== null && behavior?.toolCalls !== undefined) {
      add("behavior.toolCalls", behavior.toolCalls);
      add("behavior.toolsObserved", 1);
    }
    if (behavior?.stream) {
      add("behavior.streamTokens", behavior.stream.outputTokens);
      add("behavior.streamMs", behavior.stream.durationMs);
      add("behavior.streamResponses", behavior.stream.responses);
    }
    if (
      event.provider !== "codex" &&
      event.tokens &&
      event.tokens.reasoning !== null &&
      event.tokens.reasoning !== undefined
    ) {
      add("behavior.reasoningTokens", event.tokens.reasoning);
      add("behavior.reasoningOutput", event.tokens.output);
      add("behavior.reasoningObserved", 1);
    }
    await this.record(source, identity + ":behavior", "behavior", rows);
  }
  /** Inject this narrow port into backend services; source IDs and permissions stay local. */
  forSource(source: string): FeatureReporter {
    const record = (
      feature: TelemetryFeature,
      outcome: FeatureOutcome,
      id: string,
      permission: number | null,
    ) => {
      // Callers never wait for disk/network, and telemetry can never fail their operation.
      if (
        !telemetryFeatures.includes(feature) ||
        ![
          "attempted",
          "succeeded",
          "failed",
          "cancelled",
          "unavailable",
        ].includes(outcome) ||
        permission === null ||
        this.observationCount >= 1000
      )
        return;
      this.observationCount++;
      this.observations = this.observations
        .then(() => this.feature(source, id, feature, outcome, permission))
        .catch(() => undefined)
        .finally(() => {
          this.observationCount--;
        });
    };
    const begin = (feature: TelemetryFeature) => {
      const permission = this.permission(source);
      const id = randomUUID();
      let finished = false;
      record(feature, "attempted", id + ":attempt", permission);
      return (outcome: FeatureCompletion) => {
        if (finished) return;
        finished = true;
        record(feature, outcome, id, permission);
      };
    };
    return {
      record: (feature, outcome = "succeeded") =>
        record(feature, outcome, randomUUID(), this.permission(source)),
      begin,
      track: async (feature, action, classify) => {
        const finish = begin(feature);
        try {
          const result = await action();
          // Classification is app policy; observer mistakes must preserve the successful result.
          let outcome: FeatureCompletion = "succeeded";
          try {
            outcome = classify?.(result) ?? outcome;
          } catch {
            return result;
          }
          finish(outcome);
          return result;
        } catch (error) {
          finish("failed");
          throw error;
        }
      },
    };
  }
  /** Wait for accepted local observations, without triggering an upload. */
  async drain(): Promise<void> {
    await this.observations;
  }
  permission(source: string): number | null {
    return this.allowed(source) ? this.generation : null;
  }
  async beginFeature(
    source: string,
    feature: ClientFeature,
    origin?: ObservationOrigin | null,
  ): Promise<string | null> {
    if (!clientFeatures.includes(feature)) throw new Error("Invalid feature.");
    if (origin === null) return null;
    const reportingSource = origin?.source ?? source;
    const permission = origin ? origin.permission : this.permission(source);
    if (permission === null || permission !== this.permission(reportingSource))
      return null;
    for (const [key, value] of this.operations)
      if (value.at < this.now() - 600000) this.operations.delete(key);
    if (this.operations.size >= 1000) return null;
    const id = randomUUID();
    this.operations.set(id, {
      source,
      reportingSource,
      feature,
      permission,
      at: this.now(),
    });
    await this.feature(
      reportingSource,
      id + ":attempt",
      feature,
      "attempted",
      permission,
    );
    return id;
  }
  async finishFeature(
    source: string,
    id: string,
    outcome: Exclude<FeatureOutcome, "attempted">,
  ): Promise<void> {
    if (!["succeeded", "failed", "cancelled", "unavailable"].includes(outcome))
      throw new Error("Invalid outcome.");
    const operation = this.operations.get(id);
    if (!operation || operation.source !== source) return;
    this.operations.delete(id);
    if (operation.at < this.now() - 600000) return;
    await this.feature(
      operation.reportingSource,
      id,
      operation.feature,
      outcome,
      operation.permission,
    );
  }
  async feature(
    source: string,
    operationId: string,
    feature: TelemetryFeature,
    outcome: FeatureOutcome,
    permission: number | null = this.permission(source),
  ): Promise<void> {
    if (permission === null || permission !== this.generation) return;
    await this.record(source, "feature:" + operationId, "feature", [
      {
        day: utcDay(this.now()),
        metric: `feature.${outcome}`,
        feature,
        value: 1,
      },
    ]);
  }
  private async record(
    source: string,
    id: string,
    family: TelemetryReport["family"],
    rows: TelemetryRow[],
  ): Promise<void> {
    id = createHash("sha256").update(id).digest("hex");
    if (
      !this.allowed(source) ||
      id.length > 1000 ||
      this.state.seen.some((s) => s.id === id)
    )
      return;
    this.prune();
    const report: TelemetryReport = {
      schema: 1,
      reportId: randomUUID(),
      family,
      version: this.config.version,
      channel: this.config.channel,
      platform: this.config.platform,
      client: this.config.client,
      rows,
    };
    if (!isTelemetryReport(report)) return;
    let batch = this.state.queue.find(
      (b) =>
        !b.sealed &&
        b.report.channel === report.channel &&
        b.report.version === report.version &&
        b.report.platform === report.platform &&
        b.report.client === report.client &&
        b.report.family === family &&
        b.report.rows.length + rows.length <= telemetryLimits.rows &&
        rows.every(
          (row) =>
            !b.report.rows.some(
              (r) =>
                r.day === row.day &&
                r.metric === row.metric &&
                r.provider === row.provider &&
                r.model === row.model &&
                r.feature === row.feature &&
                r.value + row.value > telemetryLimits.count,
            ),
        ),
    );
    if (!batch) {
      batch = {
        report: { ...report, rows: [] },
        created: this.now(),
        next: this.now() + (this.config.immediate ? 0 : 300000),
        attempts: 0,
        sealed: false,
      };
      this.state.queue.push(batch);
    }
    for (const row of rows) {
      const match = batch.report.rows.find(
        (r) =>
          r.day === row.day &&
          r.metric === row.metric &&
          r.provider === row.provider &&
          r.model === row.model &&
          r.feature === row.feature,
      );
      if (match && match.value + row.value <= telemetryLimits.count)
        match.value += row.value;
      else if (!match) batch.report.rows.push(row);
    }
    this.state.seen.push({ id, at: this.now() });
    this.prune();
    try {
      await this.save();
    } catch {
      this.closed = true;
      this.generation++;
      this.controller?.abort();
      this.state.queue = [];
      this.eligible.clear();
      this.operations.clear();
    }
    this.schedule();
  }
  private baseAllowed(): boolean {
    return (
      !this.closed &&
      !this.config.forceOff &&
      this.config.environment &&
      !!this.config.endpoint
    );
  }
  private prune(): void {
    const cutoff = this.now() - telemetryLimits.days * 86400000;
    const earliestDay = utcDay(
      this.now() - (telemetryLimits.days - 1) * 86400000,
    );
    this.state.queue = this.state.queue.filter(
      (b) =>
        b.created > cutoff &&
        (!b.sealed || b.report.rows.every((r) => r.day >= earliestDay)),
    );
    for (const batch of this.state.queue)
      if (!batch.sealed)
        batch.report.rows = batch.report.rows.filter(
          (r) => r.day >= earliestDay,
        );
    this.state.queue = this.state.queue.filter((b) => b.report.rows.length > 0);
    this.state.seen = this.state.seen
      .filter((s) => s.at > cutoff)
      .slice(-10000);
    while (
      Buffer.byteLength(JSON.stringify(this.state)) > telemetryLimits.queueBytes
    ) {
      if (this.state.queue.length) this.state.queue.shift();
      else if (this.state.seen.length) this.state.seen.shift();
      else break;
    }
    while (this.eligible.size > 10000)
      this.eligible.delete(this.eligible.keys().next().value!);
  }
  private save(): Promise<void> {
    return this.store.save(this.state);
  }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.send().finally(() => {
      this.flight = null;
      this.schedule();
    });
    return this.flight;
  }
  private async send(): Promise<void> {
    if (!this.baseAllowed() || this.controller) return;
    this.prune();
    const batch = this.state.queue.find((b) => b.next <= this.now());
    if (!batch) return;
    const generation = this.generation;
    batch.sealed = true;
    await this.save();
    if (generation !== this.generation || !this.baseAllowed()) return;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.deliver(this.config.endpoint!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch.report),
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      await response.body?.cancel();
      if (generation !== this.generation) return;
      if (response.ok || [400, 413, 422].includes(response.status))
        this.state.queue = this.state.queue.filter((b) => b !== batch);
      else {
        batch.attempts++;
        batch.next =
          this.now() +
          Math.min(86400000, 60000 * 2 ** Math.min(batch.attempts, 10)) *
            (0.5 + this.random());
      }
    } catch {
      if (generation === this.generation) {
        batch.attempts++;
        batch.next =
          this.now() +
          Math.min(86400000, 60000 * 2 ** Math.min(batch.attempts, 10)) *
            (0.5 + this.random());
      }
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
      await this.save();
    }
  }
  async close(): Promise<void> {
    await this.drain();
    this.closed = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.controller?.abort();
    await this.flight?.catch(() => undefined);
    await this.store.close().catch(() => undefined);
  }
}
