import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  serializeDailyTelemetry,
  type DailyTelemetryPayload,
  type SealedTelemetryBody,
} from "@workspace/core/telemetry";
import type {
  TelemetryConsentState,
  TelemetryConsentTransition,
  TelemetryDeliveryPort,
} from "@workspace/core/telemetry-consent";
import { isUtcDay } from "@workspace/core/usage";
import type { UsageService } from "../usage/usage-service";

const DAY = 86_400_000;
const BACKOFF = [60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, DAY];
const MAX_BODY = 64 * 1024;
type Binding = { installId: string; eligibleFrom: number };
type Report = {
  day: string;
  body: string | null;
  status: "active" | "pending" | "done";
  attempts: number;
  nextAttemptAt: number;
};
type Store = { v: 1; owner: Binding | null; days: Report[] };
type Options = {
  file: string;
  consent(): Readonly<TelemetryConsentState>;
  usage: Pick<UsageService, "previewTelemetry">;
  version: string;
  platform: string;
  /** Privately supplied; absent/invalid means no requests, including discovery. */
  endpoint?: string;
  /** Fresh local desktop observation; failure/disconnection means no activity. */
  foreground(): Promise<boolean>;
  now?: () => number;
  random?: () => number;
  fetch?: typeof fetch;
};
const startOfDay = (day: string) => Date.parse(`${day}T00:00:00Z`);
const sameOwner = (a: Binding | null, b: Binding | null) =>
  a?.installId === b?.installId && a?.eligibleFrom === b?.eligibleFrom;
const empty = (): Store => ({ v: 1, owner: null, days: [] });

/** One instance per local installation runtime. This is the sole app-side owner
 * of sealing, delivery state, telemetry HTTP, retry scheduling and cancellation.
 * Callers supply lifecycle facts, never bodies, events, timestamps or endpoints.
 */
export class TelemetryUploadService implements TelemetryDeliveryPort {
  private store: Store = empty();
  private storage: Promise<void> = Promise.resolve();
  private working: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt: AbortController | null = null;
  private started = false;
  private stopped = false;
  private invalid = false;
  private again = false;
  private generation = 0;
  private readonly endpoint: string | null;
  private constructor(private readonly options: Options) {
    let endpoint: URL | undefined;
    try {
      endpoint = options.endpoint ? new URL(options.endpoint) : undefined;
    } catch {
      /* no configured transport */
    }
    this.endpoint =
      endpoint &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash &&
      (endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(endpoint.hostname)))
        ? endpoint.href
        : null;
  }
  static async open(options: Options): Promise<TelemetryUploadService> {
    const service = new TelemetryUploadService(options);
    try {
      const saved = await readFile(options.file);
      if (saved.length > 8 * (MAX_BODY * 2 + 1024))
        throw new Error("Oversized state");
      service.store = service.decode(JSON.parse(saved.toString("utf8")));
    } catch (error) {
      // Corruption is not permission to reconstruct already-sealed history.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        service.invalid = true;
    }
    if (!sameOwner(service.store.owner, service.authority())) {
      service.store = { ...empty(), owner: service.authority() };
      await service.persist().catch(() => {
        service.invalid = true;
      });
    }
    return service;
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.wake();
  }
  /** Records only this observed foreground/open instant. No foreground lease
   * survives disconnect, sleep or restart. Background time cannot fill gaps.
   */
  async activity(): Promise<void> {
    if (this.stopped || this.invalid) return;
    try {
      await this.markActivity();
    } catch {
      /* telemetry never blocks an app action */
    }
    this.wake();
  }
  async consentChanged(transition: TelemetryConsentTransition): Promise<void> {
    if (
      transition.reason === "enable" &&
      !this.invalid &&
      sameOwner(this.store.owner, this.authority())
    ) {
      this.wake();
      return;
    }
    ++this.generation;
    this.attempt?.abort();
    this.clearTimer();
    this.invalid = false;
    this.store = { ...empty(), owner: this.authority() };
    // Cancellation/purge does not wait for a ledger read or HTTP acknowledgement.
    try {
      await this.persist();
    } catch {
      this.invalid = true;
    }
    this.wake();
  }
  async sealedReport(day: string): Promise<SealedTelemetryBody | null> {
    if (this.invalid || !sameOwner(this.store.owner, this.authority()))
      return null;
    const row = this.store.days.find((row) => row.day === day);
    return row?.body ? Object.freeze({ body: row.body }) : null;
  }
  async close(): Promise<void> {
    this.stopped = true;
    ++this.generation;
    this.clearTimer();
    this.attempt?.abort();
    await this.working;
    await this.storage;
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private authority(): Binding | null {
    const state = this.options.consent();
    return state.enabled && state.eligibleFrom !== null
      ? { installId: state.installId, eligibleFrom: state.eligibleFrom }
      : null;
  }
  private valid(generation: number): boolean {
    return (
      !this.stopped &&
      !this.invalid &&
      generation === this.generation &&
      this.store.owner !== null &&
      sameOwner(this.store.owner, this.authority())
    );
  }
  private async markActivity(): Promise<void> {
    const owner = this.authority();
    if (
      !owner ||
      !sameOwner(owner, this.store.owner) ||
      this.now() < owner.eligibleFrom
    )
      return;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.store.days.some((row) => row.day === day)) return;
    this.prune();
    this.store.days.push({
      day,
      body: null,
      status: "active",
      attempts: 0,
      nextAttemptAt: 0,
    });
    await this.persist();
  }
  private prune(): boolean {
    const before = this.store.days.length;
    const today = Math.floor(this.now() / DAY) * DAY;
    this.store.days = this.store.days.filter(
      (row) =>
        startOfDay(row.day) >= today - 7 * DAY && startOfDay(row.day) <= today,
    );
    return before !== this.store.days.length;
  }
  private wake(): void {
    if (!this.started || this.stopped || this.invalid) return;
    this.clearTimer();
    if (this.working) {
      this.again = true;
      return;
    }
    this.working = this.run()
      .catch(() => {
        /* local failure stays non-disruptive; next maintenance may retry */
      })
      .finally(() => {
        this.working = null;
        if (this.again) {
          this.again = false;
          this.wake();
        } else this.schedule();
      });
  }
  private reportEligible(row: Report): boolean {
    const today = Math.floor(this.now() / DAY) * DAY;
    return (
      this.store.days.includes(row) &&
      startOfDay(row.day) >= today - 7 * DAY &&
      startOfDay(row.day) < today
    );
  }
  private async run(): Promise<void> {
    const generation = this.generation;
    if (!this.valid(generation)) return;
    if (this.prune()) await this.persist();
    // Each observation is fresh; a detached daemon has no foreground evidence.
    try {
      if ((await this.options.foreground()) && this.valid(generation))
        await this.markActivity();
    } catch {
      /* no connected desktop */
    }
    if (!this.valid(generation)) return;
    for (const row of [...this.store.days].sort((a, b) =>
      a.day.localeCompare(b.day),
    )) {
      if (!this.valid(generation)) return;
      if (startOfDay(row.day) + DAY > this.now() || row.status === "done")
        continue;
      if (row.status === "active") {
        const sealed = await this.options.usage.previewTelemetry(
          { ...this.store.owner!, day: row.day, eligibleUntil: null },
          this.options.version,
          this.options.platform,
        );
        if (!this.valid(generation)) return;
        if (!this.reportEligible(row)) {
          this.prune();
          await this.persist();
          continue;
        }
        if (Buffer.byteLength(sealed.body, "utf8") > MAX_BODY) {
          row.status = "done";
          await this.persist();
          continue;
        }
        row.body = sealed.body;
        row.status = "pending";
        await this.persist();
      }
      if (
        !this.endpoint ||
        !this.valid(generation) ||
        !this.reportEligible(row) ||
        row.nextAttemptAt > this.now()
      )
        continue;
      if (row.attempts >= 6) {
        row.status = "done";
        await this.persist();
        continue;
      }
      // Consume the attempt durably BEFORE transport. A crash/lost ACK can retry
      // these same bytes, but cannot exceed the total persisted attempt budget.
      ++row.attempts;
      row.nextAttemptAt = this.now() + this.delay(row.attempts);
      await this.persist();
      if (!this.valid(generation)) return;
      if (!this.reportEligible(row)) {
        this.prune();
        await this.persist();
        continue;
      }
      const result = await this.send(row.body!);
      if (!this.valid(generation)) return;
      if (result.done || row.attempts >= 6) row.status = "done";
      else
        row.nextAttemptAt =
          this.now() + Math.max(this.delay(row.attempts), result.retryAfter);
      await this.persist();
    }
  }
  private delay(attempt: number): number {
    const random = Math.min(
      1,
      Math.max(0, this.options.random?.() ?? Math.random()),
    );
    return Math.min(
      DAY,
      Math.round(
        BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)]! *
          (0.8 + random * 0.4),
      ),
    );
  }
  private async send(
    body: string,
  ): Promise<{ done: boolean; retryAfter: number }> {
    const controller = new AbortController();
    this.attempt = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(new Error("Cancelled telemetry attempt"));
      controller.signal.addEventListener("abort", abortListener, {
        once: true,
      });
      timer = setTimeout(() => controller.abort(), 10_000);
      timer.unref?.();
    });
    try {
      // No await between the last authoritative consent guard and fetch.
      if (
        !this.authority() ||
        !sameOwner(this.store.owner, this.authority()) ||
        this.stopped
      )
        return { done: false, retryAfter: 0 };
      const response = await Promise.race([
        (this.options.fetch ?? fetch)(this.endpoint!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        }),
        aborted,
      ]);
      const retry =
        response.status === 408 ||
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599);
      const value = response.headers.get("Retry-After");
      let retryAfter =
        value && /^\d+$/.test(value)
          ? Number(value) * 1000
          : value
            ? Date.parse(value) - this.now()
            : 0;
      retryAfter = Number.isFinite(retryAfter)
        ? Math.min(DAY, Math.max(0, retryAfter))
        : 0;
      // Response content is not part of the contract; never read/log/store it.
      void response.body?.cancel().catch(() => undefined);
      return { done: !retry, retryAfter };
    } catch {
      return { done: false, retryAfter: 0 };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abortListener);
      if (this.attempt === controller) this.attempt = null;
    }
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private schedule(): void {
    if (this.stopped || !this.started || this.invalid || !this.authority())
      return;
    const next = this.store.days
      .filter((row) => row.status === "pending" && this.endpoint)
      .map((row) => row.nextAttemptAt);
    const midnight = (Math.floor(this.now() / DAY) + 1) * DAY;
    const delay = Math.max(
      1,
      Math.min(
        60_000,
        midnight - this.now(),
        ...next.map((at) => at - this.now()),
      ),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      this.wake();
    }, delay);
    this.timer.unref?.();
  }
  private persist(): Promise<void> {
    const body = JSON.stringify(this.store);
    const run = this.storage.then(async () => {
      await mkdir(path.dirname(this.options.file), {
        recursive: true,
        mode: 0o700,
      });
      const temporary = `${this.options.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { mode: 0o600, flag: "wx" });
        await rename(temporary, this.options.file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    this.storage = run.catch(() => undefined);
    return run;
  }
  private decode(value: Store): Store {
    const keys = (object: object, names: string[]) =>
      !!object &&
      typeof object === "object" &&
      Object.keys(object).sort().join(",") === names.sort().join(",");
    if (
      !keys(value, ["v", "owner", "days"]) ||
      value.v !== 1 ||
      !Array.isArray(value.days) ||
      value.days.length > 8
    )
      throw new Error("Invalid state");
    if (
      value.owner !== null &&
      (!keys(value.owner, ["installId", "eligibleFrom"]) ||
        !Number.isSafeInteger(value.owner.eligibleFrom) ||
        value.owner.eligibleFrom < 0 ||
        value.owner.eligibleFrom % DAY !== 0 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          value.owner.installId,
        ))
    )
      throw new Error("Invalid owner");
    const days = new Set<string>();
    for (const row of value.days) {
      if (
        !value.owner ||
        !keys(row, ["day", "body", "status", "attempts", "nextAttemptAt"]) ||
        !isUtcDay(row.day) ||
        days.has(row.day) ||
        startOfDay(row.day) < value.owner.eligibleFrom ||
        !Number.isSafeInteger(row.attempts) ||
        row.attempts < 0 ||
        row.attempts > 6 ||
        !Number.isSafeInteger(row.nextAttemptAt) ||
        row.nextAttemptAt < 0
      )
        throw new Error("Invalid day");
      days.add(row.day);
      if (
        !["active", "pending", "done"].includes(row.status) ||
        (row.status === "active" &&
          (row.body !== null || row.attempts !== 0)) ||
        (row.status === "pending" && row.body === null)
      )
        throw new Error("Invalid report");
      if (row.body !== null) {
        if (
          typeof row.body !== "string" ||
          Buffer.byteLength(row.body, "utf8") > MAX_BODY
        )
          throw new Error("Invalid body");
        const parsed: DailyTelemetryPayload = JSON.parse(row.body);
        if (
          parsed.installId !== value.owner.installId ||
          parsed.day !== row.day ||
          serializeDailyTelemetry(parsed).body !== row.body
        )
          throw new Error("Unsealed body");
      }
    }
    return value;
  }
}
