import type { Consumption } from '@workspace/core/usage';
import { record } from './acp-connection';

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e9;

/**
 * ACP `PromptResponse.usage` reports input inclusive of cached reads (checked against
 * the conversation database: uncached + cached = inputTokens) and leaves thoughts out
 * of output. Korus stores reasoning as a subset of output. Cache writes are not billed
 * separately by Gemini's implicit cache; a non-zero value is unmodeled, so the turn
 * stays unmeasured.
 */
export function acpConsumption(usage: unknown): Consumption | null {
  if (!record(usage)) return null;
  const { inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens, thoughtTokens } = usage;
  if (!count(inputTokens) || !count(outputTokens)) return null;
  const cached = cachedReadTokens ?? 0, thoughts = thoughtTokens ?? 0;
  if (!count(cached) || !count(thoughts) || cached > inputTokens || (cachedWriteTokens ?? 0) !== 0) return null;
  return { input: inputTokens, output: outputTokens + thoughts, total: inputTokens + outputTokens + thoughts, cacheRead: cached, cacheWrite: 0, reasoning: thoughts };
}

/** The model the session currently has selected; the ACP never reports the model that served a turn. */
export function selectedModel(configuration: Record<string, unknown>): string | null {
  const options = Array.isArray(configuration.configOptions) ? configuration.configOptions : [];
  const option = options.find(value => record(value) && value.id === 'model');
  if (record(option) && typeof option.currentValue === 'string' && option.currentValue) return option.currentValue;
  const models = record(configuration.models) ? configuration.models : {};
  return typeof models.currentModelId === 'string' && models.currentModelId ? models.currentModelId : null;
}
