import type {
  TelemetryProvider,
  TelemetryServiceTier,
} from "./telemetry";

/** Exact nonnegative decimal strings; convert for plotting only after checking
 * the display range. Unknown measurements remain null, with excluded counts.
 * Totals retain all known subtotals; coverage counts missing turn measurements and
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
  measuredTurns?: string;
  unmeasuredTurns?: string;
  inputTokens: string | null;
  unknownInputGroups: string;
  cachedInputTokens: string | null;
  unknownCachedInputGroups: string;
  outputTokens: string | null;
  unknownOutputGroups: string;
  totalTokens: string | null;
  /** Input/output subtotals from matched reporting buckets. */
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
  model: string | null;
  groupServiceTiers?: boolean;
  /** IANA viewer timezone; omitted requests retain UTC semantics. */
  timeZone?: string;
};
/** Global cards use the inclusive range end, regardless of usage filters.
 * Weekly buckets start Monday in the viewer timezone and contain only the selected range's days.
 * Calendar month actives are month-to-range-end, not trailing 30 days.
 */
export type TelemetryMetrics = {
  range: TelemetryMetricsFilter;
  /** Models with recorded usage in the date/provider scope, independent of the selected model. */
  availableModels?: string[];
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
  /** Top ten anonymous installations by turns in the final seven selected days.
   * Ranks are local to this response; no installation identifier is exposed.
   * turnShare is a decimal fraction of all turns in that same scope.
   */
  weeklyTopUsers?: {
    rank: number;
    turns: string;
    totalTokens: string | null;
    estimatedCostUsd: string | null;
    turnShare: string;
  }[];
  totals: TelemetryMetricTotals;
  daily: (TelemetryMetricTotals & { day: string })[];
  weekly: (TelemetryMetricTotals & { week: string })[];
  /** Sparse viewer-day series. Absent timings remain missing, never interpolated. */
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
    estimatedCostUsd?: string | null;
    provider: TelemetryProvider;
    model: string;
    serviceTier?: TelemetryServiceTier | null;
  })[];
  models: (TelemetryMetricTotals & {
    provider: TelemetryProvider;
    model: string;
    /** Null when variants are explicitly combined. Legacy rows are unknown. */
    serviceTier?: TelemetryServiceTier | null;
  })[];
};
