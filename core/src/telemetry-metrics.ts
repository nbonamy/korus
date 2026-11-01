import type {
  TelemetryModel,
  TelemetryProvider,
  TelemetryServiceTier,
} from "./telemetry";

/** Exact nonnegative decimal strings; convert for plotting only after checking
 * the display range. Unknown measurements remain null, with excluded counts.
 * Totals are known subtotals; totalTokens uses complete input/output pairs and
 * cache share uses complete input/cache-read pairs. Never add cache reads again.
 */
export type TelemetryPerformanceMetrics = {
  outputTokensPerSecond: string | null;
  timeToFirstOutputMs: string | null;
  speedTurns: string;
  ttftTurns: string;
};
export type TelemetryMetricTotals = {
  performance?: TelemetryPerformanceMetrics;
  groups: string;
  turns: string;
  inputTokens: string | null;
  unknownInputGroups: string;
  cachedInputTokens: string | null;
  unknownCachedInputGroups: string;
  outputTokens: string | null;
  unknownOutputGroups: string;
  totalTokens: string | null;
  /** Complete input/output pairs used by additive token charts. */
  pairedInputTokens?: string | null;
  pairedOutputTokens?: string | null;
  excludedTokenGroups: string;
  cacheInputTokens: string | null;
  cacheReadTokens: string | null;
  nonCacheReadTokens: string | null;
  cacheReadShare: number | null;
  excludedCacheGroups: string;
  estimatedCostUsd: string | null;
  unknownCostGroups: string;
  costCoverage: "empty" | "complete" | "partial" | "unavailable";
};
export type TelemetryMetricsFilter = {
  from: string;
  to: string;
  provider: TelemetryProvider | null;
  model: TelemetryModel | null;
  groupServiceTiers?: boolean;
};
/** Global cards use the inclusive range end, regardless of usage filters.
 * Weekly buckets start Monday UTC and contain only the selected range's days.
 * Calendar month actives are month-to-range-end, not trailing 30 days.
 */
export type TelemetryMetrics = {
  range: TelemetryMetricsFilter;
  availability: {
    firstDay: string | null;
    lastDay: string | null;
    lastReceivedAt: string | null;
  };
  overview: {
    participatingInstalls: string;
    dau: string;
    wau: string;
    mau: string;
    calendarMonthActives: string;
  };
  activity: {
    day: string;
    activeInstalls: string;
    firstReportedInstalls: string;
  }[];
  totals: TelemetryMetricTotals;
  daily: (TelemetryMetricTotals & { day: string })[];
  weekly: (TelemetryMetricTotals & { week: string })[];
  /** Sparse UTC-day series. Absent timings remain missing, never interpolated. */
  modelDaily?: (Pick<
    TelemetryMetricTotals,
    | "turns"
    | "totalTokens"
    | "inputTokens"
    | "outputTokens"
    | "unknownInputGroups"
    | "unknownOutputGroups"
    | "excludedTokenGroups"
    | "performance"
  > & {
    day: string;
    provider: TelemetryProvider;
    model: TelemetryModel;
    serviceTier?: TelemetryServiceTier | null;
  })[];
  models: (TelemetryMetricTotals & {
    provider: TelemetryProvider;
    model: TelemetryModel;
    /** Null when variants are explicitly combined. Legacy rows are unknown. */
    serviceTier?: TelemetryServiceTier | null;
  })[];
};
