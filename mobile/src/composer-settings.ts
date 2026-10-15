import type { Agent, AgentModelSelection, BackendCapabilities, BackendModelOption } from '@workspace/core/contracts';
import type { CompanionPromptOptions } from './companion-port';

/** The phone's own choice for one agent; anything unset follows the agent's saved choice, then the provider default. */
export type ComposerChoice = { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null; planMode?: boolean };
export type ComposerSettings = { model: BackendModelOption | null; reasoningEffort: string | null; serviceTier: string | null; planMode: boolean };
export type ComposerChange = { modelId?: string; reasoningEffort?: string; serviceTier?: string | null; planMode?: boolean };

const defaultEffort = (model: BackendModelOption) => model.defaultReasoningEffort || model.supportedReasoningEfforts?.[0]?.reasoningEffort || null;
const matches = (model: BackendModelOption, selection: string | null | undefined) => Boolean(selection && (model.id === selection || model.model === selection));

export function resolveComposerSettings(agent: Agent, models: readonly BackendModelOption[], choice: ComposerChoice | undefined): ComposerSettings {
  const saved = agent.backendDefaults;
  const model = models.find((candidate) => matches(candidate, choice?.model ?? saved?.model)) ?? models.find((candidate) => candidate.isDefault) ?? models[0] ?? null;
  const savedTier = saved?.kind === 'codex' ? saved.serviceTier : undefined;
  return {
    model,
    reasoningEffort: choice?.reasoningEffort !== undefined ? choice.reasoningEffort : (saved?.reasoningEffort ?? (model ? defaultEffort(model) : null)),
    serviceTier: choice?.serviceTier !== undefined ? choice.serviceTier : (savedTier ?? model?.defaultServiceTier ?? null),
    planMode: Boolean(choice?.planMode),
  };
}

/** Applies one change from the model menu. `save` is what to persist on the laptop; plan mode stays on the phone. */
export function applyComposerChoice(models: readonly BackendModelOption[], current: ComposerChoice, change: ComposerChange): { choice: ComposerChoice; save: AgentModelSelection | null } {
  const model = models.find((candidate) => matches(candidate, current.model));
  if (change.modelId !== undefined) {
    const next = models.find((candidate) => candidate.id === change.modelId);
    if (!next) return { choice: current, save: null };
    const choice = { ...current, model: next.model, reasoningEffort: defaultEffort(next), serviceTier: next.defaultServiceTier ?? null };
    return { choice, save: { model: next.model, reasoningEffort: choice.reasoningEffort, serviceTier: choice.serviceTier } as AgentModelSelection };
  }
  if (change.reasoningEffort !== undefined) {
    if (!model?.supportedReasoningEfforts?.some((option) => option.reasoningEffort === change.reasoningEffort)) return { choice: current, save: null };
    const choice = { ...current, reasoningEffort: change.reasoningEffort };
    return { choice, save: { model: model.model, reasoningEffort: change.reasoningEffort, serviceTier: current.serviceTier ?? null } as AgentModelSelection };
  }
  if (change.serviceTier !== undefined) {
    if (!model || (change.serviceTier !== null && !model.serviceTiers?.some((tier) => tier.id === change.serviceTier))) return { choice: current, save: null };
    const choice = { ...current, serviceTier: change.serviceTier };
    return { choice, save: { model: model.model, reasoningEffort: current.reasoningEffort ?? null, serviceTier: change.serviceTier } as AgentModelSelection };
  }
  if (change.planMode !== undefined) return { choice: { ...current, planMode: change.planMode }, save: null };
  return { choice: current, save: null };
}

/** Mirrors the desktop composer: only what the provider supports travels with the prompt. */
export function promptOptionsFor(settings: ComposerSettings, capabilities: Pick<BackendCapabilities, 'models' | 'reasoningEffort' | 'serviceTier' | 'planMode'>): CompanionPromptOptions | undefined {
  const model = capabilities.models ? settings.model : null;
  const reasoningEffort = capabilities.reasoningEffort && model ? settings.reasoningEffort ?? defaultEffort(model) : null;
  const serviceTier = capabilities.serviceTier && model?.serviceTiers?.length ? settings.serviceTier : undefined;
  const planMode = capabilities.planMode === 'native' ? settings.planMode : capabilities.planMode === 'prompted' && settings.planMode ? true : undefined;
  if (!model && planMode === undefined && !reasoningEffort && serviceTier === undefined) return undefined;
  return { ...(model ? { model: model.model } : {}), ...(planMode === undefined ? {} : { planMode }),
    ...(reasoningEffort ? { reasoningEffort } : {}), ...(serviceTier === undefined ? {} : { serviceTier }) };
}
