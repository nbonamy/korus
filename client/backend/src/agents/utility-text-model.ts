import type { HarnessProvider, ProviderModelOption } from '@workspace/core/contracts';
import type { UtilityTaskComplexity } from '@workspace/core/provider-driver';

/** Fixed families per task tier; native catalogs supply usable IDs, never another provider. */
const preferences: Record<HarnessProvider, Record<UtilityTaskComplexity, readonly RegExp[]>> = {
  codex: {
    simple: [/^gpt-6\.1-luna\b/i, /^gpt-6-luna\b/i, /\bluna\b/i],
    normal: [/^gpt-6\.1-sol\b/i, /^gpt-6-sol\b/i, /\bsol\b/i],
    complex: [/\bastra\b/i, /^gpt-6\.1-sol\b/i, /\bsol\b/i],
  },
  claude: { simple: [/^haiku$/i, /\bhaiku\b/i], normal: [/^sonnet$/i, /\bsonnet\b/i], complex: [/^opus$/i, /\bopus\b/i] },
  cursor: { simple: [], normal: [], complex: [] },
  antigravity: {
    simple: [/flash[-\s]?lite/i],
    normal: [/gemini.*\bflash\b(?![-\s]*lite)/i],
    complex: [/gemini.*pro.*\bhigh\b/i, /gemini.*\bpro\b/i],
  },
};

const fallbackTiers: Record<UtilityTaskComplexity, readonly UtilityTaskComplexity[]> = {
  simple: ['simple', 'normal', 'complex'], normal: ['normal', 'simple', 'complex'], complex: ['complex', 'normal', 'simple'],
};

export function utilityTextModel(provider: HarnessProvider, models: readonly ProviderModelOption[], complexity: UtilityTaskComplexity = 'simple'): { model: string; reasoningEffort?: string } {
  // The family meant for the task, else the nearest one the account offers (cheapest first), else whatever it runs by default.
  const tiers = fallbackTiers[complexity];
  const model = tiers.flatMap(tier => preferences[provider][tier]).map(pattern => models.find(model => pattern.test(model.model) || pattern.test(model.displayName)))
    .find(model => model !== undefined) ?? models.find(model => model.isDefault) ?? models[0];
  if (!model) throw new Error(`No text model is available for ${provider}. Refresh the provider's model catalog and try again.`);
  const efforts = model.supportedReasoningEfforts;
  const desired = { simple: 'low', normal: 'medium', complex: 'high' }[complexity];
  const reasoningEffort = efforts?.find(effort => effort.reasoningEffort === desired)?.reasoningEffort
    ?? efforts?.find(effort => effort.reasoningEffort === model.defaultReasoningEffort)?.reasoningEffort ?? efforts?.[0]?.reasoningEffort;
  return { model: model.model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}
