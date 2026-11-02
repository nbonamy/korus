import type { AgentBackend, BackendModelOption } from '@workspace/core/contracts';

/** Fixed lightweight families for app utilities; native catalogs supply usable IDs. */
const preferences: Record<AgentBackend, readonly RegExp[]> = {
  codex: [/^gpt-6\.1-luna\b/i, /^gpt-6-luna\b/i, /\bluna\b/i],
  claude: [/^haiku$/i, /\bhaiku\b/i],
  antigravity: [/flash[-\s]?lite/i, /flash.*\blow\b/i, /\bflash\b/i],
};

export function utilityTextModel(backend: AgentBackend, models: readonly BackendModelOption[]): { model: string; reasoningEffort?: string } {
  const model = preferences[backend].map(pattern => models.find(model => pattern.test(model.model) || pattern.test(model.displayName)))
    .find(model => model !== undefined);
  if (!model) throw new Error(`No lightweight text model is available for ${backend}. Refresh the provider's model catalog and retry.`);
  const efforts = model.supportedReasoningEfforts;
  const reasoningEffort = efforts?.find(effort => effort.reasoningEffort === 'low')?.reasoningEffort ?? efforts?.[0]?.reasoningEffort;
  return { model: model.model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}
