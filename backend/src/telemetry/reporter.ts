import { randomUUID, createHash } from "node:crypto";
import {
  clientFeatures,
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
export type ReporterConfig = {
  rollout: boolean;
  forceOff: boolean;
  environment: boolean;
  endpoint: string | null;
  synthetic?: boolean;
  version: string;
  channel: "stable" | "preview";
  platform: "macos" | "windows" | "linux";
  client: "desktop" | "web" | "mobile" | "daemon";
};
export class TelemetryReporter {
  private state: State = { choices: {}, queue: [], seen: [] };
  private generation = 0;
  private controller: AbortController | null = null;
  private closed = false;
  private flight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private eligible = new Map<string, string>();
  private operations = new Map<
    string,
    { source: string; feature: ClientFeature; permission: number; at: number }
  >();
  private readonly store: JsonStore<State>;
  constructor(
    file: string,
    private readonly config: ReporterConfig,
    private readonly now: () => number = Date.now,
    private readonly deliver: typeof fetch = fetch,
    private readonly random: () => number = Math.random,
  ) {
    this.store = new JsonStore(file);
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
        throw new Error("Invalid telemetry endpoint.");
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
            Number.isFinite(b.created) &&
            Number.isFinite(b.next) &&
            Number.isSafeInteger(b.attempts) &&
            b.attempts >= 0,
        )
        .map((b) => ({ ...b, sealed: true }));
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
    await this.save();
  }
  start(): void {
    if (!this.timer && this.baseAllowed()) {
      this.timer = setInterval(() => {
        void this.flush().catch(() => undefined);
      }, 60000);
      this.timer.unref();
    }
  }
  privacy(source: string): TelemetryPrivacy {
    const choice = this.state.choices[source] ?? null;
    const blocked = this.config.forceOff
      ? "administrator"
      : !this.config.environment
        ? "environment"
        : !this.config.rollout || !this.config.endpoint
          ? "rollout"
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
    if (event.phase !== "started") this.eligible.delete(identity);
  }
  permission(source: string): number | null {
    return this.allowed(source) ? this.generation : null;
  }
  async beginFeature(
    source: string,
    feature: ClientFeature,
  ): Promise<string | null> {
    if (!clientFeatures.includes(feature)) throw new Error("Invalid feature.");
    const permission = this.permission(source);
    if (permission === null) return null;
    for (const [key, value] of this.operations)
      if (value.at < this.now() - 600000) this.operations.delete(key);
    if (this.operations.size >= 1000) return null;
    const id = randomUUID();
    this.operations.set(id, { source, feature, permission, at: this.now() });
    await this.feature(
      source,
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
      source,
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
        next: this.now() + 3600000 + Math.floor(this.random() * 3600000),
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
  }
  private baseAllowed(): boolean {
    return (
      !this.closed &&
      this.config.rollout &&
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
    this.closed = true;
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.flight;
    await this.store.close();
  }
}
