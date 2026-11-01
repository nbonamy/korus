import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type {
  TelemetryConsentAction,
  TelemetryConsentState,
  TelemetryConsentView,
  TelemetryDeliveryPort,
  TelemetryProfilePreview,
} from "@workspace/core/telemetry-consent";
import { isUtcDay } from "@workspace/core/usage";
import type { UsageService } from "../usage/usage-service";

export type TelemetrySettingsStorage = {
  load(): Promise<TelemetryConsentState | undefined>;
  save(state: TelemetryConsentState): Promise<void>;
};

type Options = {
  legacyFile?: string;
  now?: () => number;
  delivery?: TelemetryDeliveryPort;
};
const dayMs = 86400000;
/** Local sharing choice and identity, stored through the common settings writer. No shared
 * snapshot, generic settings event, provider access or delivery policy lives here.
 */
export class TelemetryConsentService {
  private operations: Promise<unknown> = Promise.resolve();
  private pendingRevocations = 0;
  private authorityRevision = 0;
  private constructor(
    private readonly storage: TelemetrySettingsStorage,
    private state: TelemetryConsentState,
    private readonly options: Options,
  ) {}
  static async open(storage: TelemetrySettingsStorage, options: Options = {}): Promise<TelemetryConsentService> {
    let state = await storage.load();
    if (!state) {
      let legacy;
      if (options.legacyFile) {
        try { legacy = JSON.parse(await readFile(options.legacyFile, 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      if (legacy && (![1, 2].includes(legacy.v) || typeof legacy.enabled !== 'boolean'
        || typeof legacy.noticeHandled !== 'boolean'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(legacy.installId))) {
        throw new Error('Telemetry state is unavailable.');
      }
      state = { installId: legacy?.installId ?? randomUUID(),
        ...(legacy?.noticeHandled ? { enabled: legacy.enabled } : {}) };
      await storage.save(state);
    }
    if (options.legacyFile) await unlink(options.legacyFile).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    return new TelemetryConsentService(storage, state, options);
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
        ? { enabled: false }
        : {}),
    });
  }
  async view(): Promise<TelemetryConsentView> {
    await this.operations;
    const state = this.current();
    return {
      enabled: state.enabled,
    };
  }
  change(action: TelemetryConsentAction): Promise<TelemetryConsentView> {
    const revokes = ["disable", "reset"].includes(action);
    if (revokes) ++this.pendingRevocations;
    ++this.authorityRevision;
    return this.serial(async () => {
      if (!["enable", "disable", "reset"].includes(action))
        throw new Error("Invalid telemetry action.");
      const previous = Object.freeze({ ...this.state });
      const current = { ...previous, enabled: action === "enable" };
      if (action === "reset") current.installId = randomUUID();
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
          if (!current.enabled || saved) {
            const transition = {
              reason: action,
              previous,
              current: Object.freeze({ ...current }),
            };
            await this.options.delivery?.consentChanged(transition);
          }
        }
      }
      return {
        enabled: current.enabled,
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
    const enabled = state.enabled === true;
    if (enabled && start + dayMs <= this.now()) {
      const sealed = await this.options.delivery?.sealedReport(day);
      if (sealed) return finish({ kind: "sealed", body: sealed.body });
    }
    const body = await usage.previewTelemetry(
      {
        installId: state.installId,
        day,
      },
      version,
      platform,
    );
    return finish({
      kind:
        enabled && start + dayMs > this.now() ? "provisional" : "hypothetical",
      body: body.body,
    });
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private persist(state: TelemetryConsentState): Promise<void> {
    return this.storage.save(state);
  }
}
