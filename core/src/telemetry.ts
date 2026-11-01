import { isUtcDay } from "./usage";
import { telemetryModels } from "./telemetry-models";

export type TelemetryProvider = "codex" | "claude" | "antigravity";
export type TelemetryModel = (typeof telemetryModels)[number] | "unknown";
export type TelemetryOs = "macos" | "windows" | "linux" | "unknown";
export type TelemetryPerformance = {
  speedTurns: number;
  outputTokens: number;
  generationMs: number;
  ttftMs: number;
  ttftTurns: number;
};
export type TelemetryUsage = {
  provider: TelemetryProvider;
  model: TelemetryModel;
  turns: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  /** Absent in older reports or when no timing was measured. */
  performance?: TelemetryPerformance;
};
export type DailyTelemetryPayload = {
  installId: string;
  day: string;
  appVersion: string;
  os: TelemetryOs;
  usage: TelemetryUsage[];
};
/** Half-open consent interval. Both execution start AND request timestamp must
 * be eligible. Callers must supply it explicitly, even for hypothetical previews.
 */
export type TelemetryProjectionInput = {
  day: string;
  eligibleFrom: number;
  eligibleUntil: number | null;
};
export type TelemetryPreviewInput = TelemetryProjectionInput & {
  installId: string;
};
/** Immutable canonical UTF-8 JSON text. Preview, persistence and retries consume
 * body verbatim; do not parse and serialize it again at the transport boundary.
 */
export type SealedTelemetryBody = Readonly<{ body: string }>;

const models = new Set<string>(telemetryModels);
export function telemetryModel(value: string | null): TelemetryModel {
  return value !== null && models.has(value)
    ? (value as TelemetryModel)
    : "unknown";
}
export function telemetryOs(platform: string): TelemetryOs {
  return platform === "darwin"
    ? "macos"
    : platform === "win32"
      ? "windows"
      : platform === "linux"
        ? "linux"
        : "unknown";
}
export function normalizeTelemetryVersion(version: string): string {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  if (!match) throw new Error("Invalid telemetry version.");
  return match.slice(1, 4).join(".");
}
const object = (
  value: unknown,
  keys: string[],
): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((k) => keys.includes(k));
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= 8640000000000000;
export function validTelemetryProjectionInput(
  value: unknown,
): value is TelemetryProjectionInput {
  return (
    object(value, ["day", "eligibleFrom", "eligibleUntil"]) &&
    isUtcDay(value.day) &&
    timestamp(value.eligibleFrom) &&
    (value.eligibleUntil === null ||
      (timestamp(value.eligibleUntil) &&
        value.eligibleUntil > value.eligibleFrom))
  );
}
export function validTelemetryPreviewInput(
  value: unknown,
): value is TelemetryPreviewInput {
  if (!object(value, ["installId", "day", "eligibleFrom", "eligibleUntil"]))
    return false;
  const { installId, ...projection } = value;
  return validInstallId(installId) && validTelemetryProjectionInput(projection);
}
function validInstallId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}
export function validTelemetryPerformance(
  value: unknown,
  turns: number,
): value is TelemetryPerformance {
  if (
    !object(value, [
      "speedTurns",
      "outputTokens",
      "generationMs",
      "ttftMs",
      "ttftTurns",
    ])
  )
    return false;
  if (
    !Object.values(value).every(
      (v) => Number.isSafeInteger(v) && (v as number) >= 0,
    )
  )
    return false;
  const p = value as TelemetryPerformance;
  return (
    p.speedTurns <= p.ttftTurns &&
    p.ttftTurns <= turns &&
    (p.speedTurns > 0
      ? p.outputTokens > 0 && p.generationMs > 0
      : p.outputTokens === 0 && p.generationMs === 0) &&
    (p.ttftTurns > 0 || p.ttftMs === 0)
  );
}
/** Closed, bounded wire contract. Construct explicit fields after validation so
 * no spread of a ledger/provider object can leak local metadata into the body.
 */
export function serializeDailyTelemetry(
  payload: DailyTelemetryPayload,
): SealedTelemetryBody {
  const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const nullableCount = (v: unknown) => v === null || count(v);
  if (
    !object(payload, ["installId", "day", "appVersion", "os", "usage"]) ||
    !validInstallId(payload.installId) ||
    !isUtcDay(payload.day) ||
    typeof payload.appVersion !== "string" ||
    normalizeTelemetryVersion(payload.appVersion) !== payload.appVersion ||
    !["macos", "windows", "linux", "unknown"].includes(payload.os) ||
    !Array.isArray(payload.usage) ||
    payload.usage.length > 256
  )
    throw new Error("Invalid telemetry payload.");
  const groups = new Set<string>();
  const usage = payload.usage
    .map((row) => {
      if (
        !object(row, [
          "provider",
          "model",
          "turns",
          "inputTokens",
          "cachedInputTokens",
          "outputTokens",
          "estimatedCostUsd",
          ...(Object.hasOwn(row, "performance") ? ["performance"] : []),
        ]) ||
        !["codex", "claude", "antigravity"].includes(row.provider) ||
        (row.model !== "unknown" && !models.has(row.model)) ||
        !count(row.turns) ||
        ![row.inputTokens, row.cachedInputTokens, row.outputTokens].every(
          nullableCount,
        ) ||
        (row.inputTokens !== null &&
          row.cachedInputTokens !== null &&
          row.cachedInputTokens > row.inputTokens) ||
        (row.estimatedCostUsd !== null &&
          !(
            Number.isFinite(row.estimatedCostUsd) &&
            row.estimatedCostUsd >= 0 &&
            row.estimatedCostUsd <= 1e9
          ))
      )
        throw new Error("Invalid telemetry usage.");
      if (
        row.performance !== undefined &&
        !validTelemetryPerformance(row.performance, row.turns)
      )
        throw new Error("Invalid telemetry performance.");
      const key = row.provider + "/" + row.model;
      if (groups.has(key)) throw new Error("Duplicate telemetry group.");
      groups.add(key);
      return {
        provider: row.provider,
        model: row.model,
        turns: row.turns,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
        estimatedCostUsd: row.estimatedCostUsd,
        ...(row.performance
          ? {
              performance: {
                speedTurns: row.performance.speedTurns,
                outputTokens: row.performance.outputTokens,
                generationMs: row.performance.generationMs,
                ttftMs: row.performance.ttftMs,
                ttftTurns: row.performance.ttftTurns,
              },
            }
          : {}),
      };
    })
    .sort((a, b) =>
      a.provider < b.provider
        ? -1
        : a.provider > b.provider
          ? 1
          : a.model < b.model
            ? -1
            : a.model > b.model
              ? 1
              : 0,
    );
  const body = JSON.stringify({
    installId: payload.installId,
    day: payload.day,
    appVersion: payload.appVersion,
    os: payload.os,
    usage,
  });
  if (new TextEncoder().encode(body).length > 65536)
    throw new Error("Telemetry body too large.");
  return Object.freeze({ body });
}
