import { validConsumption, type Consumption } from "@workspace/core/usage";
/** Optional SDK-owner contract; older packages expose no execution projection. No raw notifications/history parsing. */
export function codexExecutionConsumption(
  event: unknown,
): { tokens: Consumption | null; model: string | null } | undefined {
  if (!event || typeof event !== "object") return;
  const { type, payload } = event as {
    type?: string;
    payload?: { usage?: unknown; executionUsage?: unknown };
  };
  const projection =
    type === "conversation.executionUsageChanged"
      ? payload?.usage
      : type === "turn.completed"
        ? payload?.executionUsage
        : undefined;
  if (!projection || typeof projection !== "object") return;
  const usage = projection as { observedStart?: boolean; execution?: unknown; model?: unknown };
  if (usage.observedStart !== true) return; // Reopen/attach replay must not erase retained live evidence.
  const model = typeof usage.model === 'string' ? usage.model : null;
  if (usage.execution === null) return { tokens: null, model };
  if (!usage.execution || typeof usage.execution !== "object") return;
  const raw = usage.execution as Record<string, unknown>;
  const tokens = {
    total: raw.totalTokens,
    input: raw.inputTokens,
    output: raw.outputTokens,
    cacheRead: raw.cachedInputTokens,
    cacheWrite: raw.cacheWriteInputTokens,
    reasoning: raw.reasoningOutputTokens,
  };
  if (validConsumption(tokens)) return { tokens, model };
}
