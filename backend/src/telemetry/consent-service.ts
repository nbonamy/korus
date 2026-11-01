import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  TelemetryConsentAction,
  TelemetryConsentState,
  TelemetryConsentTransition,
  TelemetryConsentView,
  TelemetryDeliveryPort,
  TelemetryProfilePreview,
} from "@workspace/core/telemetry-consent";
import { isUtcDay } from "@workspace/core/usage";
import type { UsageService } from "../usage/usage-service";

type Options = {
  now?: () => number;
  delivery?: TelemetryDeliveryPort;
};
const dayMs = 86400000;
/** Private per-profile authority, initialized before runtime services. No shared
 * snapshot, generic settings event, provider access or delivery policy lives here.
 */
export class TelemetryConsentService {
  private operations: Promise<unknown> = Promise.resolve();
  private pendingRevocations = 0;
  private authorityRevision = 0;
  private constructor(
    private readonly file: string,
    private state: TelemetryConsentState,
    private readonly options: Options,
  ) {}
  static async open(
    file: string,
    options: Options = {},
  ): Promise<TelemetryConsentService> {
    let state: TelemetryConsentState;
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      if (
        ![1, 2].includes(saved.v) ||
        Object.keys(saved).sort().join(",") !==
          "eligibleFrom,enabled,installId,noticeHandled,v" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          saved.installId,
        ) ||
        typeof saved.enabled !== "boolean" ||
        typeof saved.noticeHandled !== "boolean" ||
        (saved.enabled
          ? !saved.noticeHandled ||
            !Number.isSafeInteger(saved.eligibleFrom) ||
            saved.eligibleFrom < 0 ||
            saved.eligibleFrom % dayMs !== 0
          : saved.eligibleFrom !== null)
      )
        throw new Error("Invalid telemetry state.");
      const { v: _v, ...loaded } = saved;
      state = loaded;
      if (saved.v === 1) {
        // The prior opt-in excluded performance. Expanded sharing needs consent.
        if (state.enabled)
          state = {
            ...state,
            enabled: false,
            eligibleFrom: null,
            noticeHandled: false,
          };
        const service = new TelemetryConsentService(file, state, options);
        await service.persist(state);
        return service;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Telemetry state is unavailable.");
      state = {
        installId: randomUUID(),
        enabled: false,
        eligibleFrom: null,
        noticeHandled: false,
      };
      const service = new TelemetryConsentService(file, state, options);
      await service.persist(state);
      return service;
    }
    return new TelemetryConsentService(file, state, options);
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.operations.then(run);
    this.operations = next.catch(() => undefined);
    return next;
  }
  /** Synchronous authority read for delivery guards, including inside transition callbacks. */
  current(): Readonly<TelemetryConsentState> {
    return Object.freeze({
      ...this.state,
      ...(this.pendingRevocations
        ? { enabled: false, eligibleFrom: null }
        : {}),
    });
  }
  async view(): Promise<TelemetryConsentView> {
    await this.operations;
    const state = this.current();
    return {
      enabled: state.enabled,
      eligibleFrom: state.eligibleFrom,
      noticePending: !state.noticeHandled,
    };
  }
  change(action: TelemetryConsentAction): Promise<TelemetryConsentView> {
    const revokes = ["disable", "dismiss", "reset"].includes(action);
    if (revokes) ++this.pendingRevocations;
    ++this.authorityRevision;
    return this.serial(async () => {
      if (!["enable", "disable", "dismiss", "reset"].includes(action))
        throw new Error("Invalid telemetry action.");
      const previous = Object.freeze({ ...this.state });
      const current = { ...previous, noticeHandled: true };
      if (action === "reset") current.installId = randomUUID();
      if (action === "enable" && !current.enabled) {
        current.enabled = true;
        current.eligibleFrom = (Math.floor(this.now() / dayMs) + 1) * dayMs;
      } else if (action !== "enable") {
        current.enabled = false;
        current.eligibleFrom = null;
      }
      if (
        action === "disable" ||
        JSON.stringify(current) !== JSON.stringify(previous)
      ) {
        // Revocation is visible in memory before I/O or cancellation can wait.
        if (!current.enabled) this.state = current;
        let saved = false;
        try {
          await this.persist(current);
          this.state = current;
          saved = true;
        } finally {
          if (
            (!current.enabled || saved) &&
            (action !== "dismiss" || previous.enabled)
          ) {
            const transition = {
              reason: action === "dismiss" ? ("disable" as const) : action,
              previous,
              current: Object.freeze({ ...current }),
            };
            await this.options.delivery?.consentChanged(transition);
          }
        }
      }
      return {
        enabled: current.enabled,
        eligibleFrom: current.eligibleFrom,
        noticePending: !current.noticeHandled,
      };
    }).finally(() => {
      if (revokes) --this.pendingRevocations;
    });
  }
  async preview(
    day: string,
    usage: UsageService,
    version: string,
    platform: string,
  ): Promise<TelemetryProfilePreview> {
    await this.operations;
    const revision = this.authorityRevision;
    const finish = (
      result: TelemetryProfilePreview,
    ): TelemetryProfilePreview => {
      if (revision !== this.authorityRevision)
        throw new Error("Telemetry preview is obsolete.");
      return result;
    };
    if (!isUtcDay(day) || day > new Date(this.now()).toISOString().slice(0, 10))
      throw new Error("Invalid telemetry day.");
    const state = this.current();
    const start = Date.parse(`${day}T00:00:00Z`);
    const eligible =
      state.enabled &&
      state.eligibleFrom !== null &&
      start >= state.eligibleFrom;
    if (eligible && start + dayMs <= this.now()) {
      const sealed = await this.options.delivery?.sealedReport(day);
      if (sealed) return finish({ kind: "sealed", body: sealed.body });
    }
    const body = await usage.previewTelemetry(
      {
        installId: state.installId,
        day,
        eligibleFrom: eligible ? state.eligibleFrom! : start,
        eligibleUntil: null,
      },
      version,
      platform,
    );
    return finish({
      kind:
        eligible && start + dayMs > this.now() ? "provisional" : "hypothetical",
      body: body.body,
    });
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private async persist(state: TelemetryConsentState): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ v: 2, ...state }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
