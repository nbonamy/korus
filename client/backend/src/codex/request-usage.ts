import type { CodexConversationEvent } from "@codex-app-sdk/core/surface";
import type {
  ExecutionObservation,
  RequestCoverageReason,
} from "@workspace/core/usage";

const fields = [
  "requestIdentity",
  "timestamp",
  "actualModel",
  "actualProvider",
  "requestTokenUsage",
  "cacheWriteLifetimes",
  "cacheWriteInputInclusion",
  "pricingContext",
  "requestedModel",
  "requestedServiceTier",
  "reportedServiceTier",
  "finality",
] as const;

/** Consume only the SDK-owned projection. Public Codex counters establish no billable requests. */
export function codexRequestCoverage(
  event: CodexConversationEvent,
):
  | Pick<ExecutionObservation, "requestCoverage" | "requestCoverageReason">
  | undefined {
  const projection =
    event.type === "conversation.executionUsageChanged"
      ? event.payload.usage
      : event.type === "turn.completed"
        ? event.payload.executionUsage
        : undefined;
  // Attaching to history must not replace evidence already retained for live executions.
  if (projection?.observedStart !== true) return;
  const value: unknown =
    "requestUsage" in projection ? projection.requestUsage : undefined;
  let reason: RequestCoverageReason = "incompatible-sdk-request-evidence";
  if (value === undefined) reason = "missing-sdk-request-evidence";
  else if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if (
      raw.status === "unavailable" &&
      raw.reason === "public-runtime-request-evidence-unavailable" &&
      raw.requests === null &&
      Array.isArray(raw.unavailableFields) &&
      raw.unavailableFields.every((field) => fields.includes(field))
    ) {
      reason = raw.reason;
    }
  }
  // No supported DTO exists in this SDK contract. Unknown/future shapes fail closed
  // at this owner boundary; selected settings and execution totals cannot fill gaps.
  return { requestCoverage: "partial", requestCoverageReason: reason };
}
