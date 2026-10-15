import type {
  TelemetryFeature,
  FeatureOutcome,
} from "@workspace/core/telemetry";

export type FeatureCompletion = Exclude<FeatureOutcome, "attempted">;
/** Finite product observations only: no content, metadata bag, source IDs or transport concerns. */
export interface FeatureReporter {
  record(feature: TelemetryFeature, outcome?: FeatureCompletion): void;
  /** Capture permission before an operation; finish once, even when called repeatedly. */
  begin(feature: TelemetryFeature): (outcome: FeatureCompletion) => void;
  /** Preserve the action's return value and error; reporting never changes its behavior. */
  track<T>(
    feature: TelemetryFeature,
    action: () => T | Promise<T>,
    classify?: (result: T) => FeatureCompletion,
  ): Promise<T>;
}
