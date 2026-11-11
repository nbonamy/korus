import type { Agent, HarnessProvider, ExecutionSelection, ProviderCapabilities, ProviderModelOption } from '@workspace/core/contracts';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import type { CompanionPromptOptions } from './companion-port';

/** The phone's own choice for one agent; anything unset follows the agent's saved choice, then the provider default. */
export type ComposerChoice = import('@workspace/core/contracts/execution').ExecutionSelectionOverrides & { planMode?: boolean };
export type ComposerSettings = Pick<ExecutionSelection, 'provider' | 'reasoningEffort' | 'serviceTier'> & { model: ProviderModelOption | null; planMode: boolean };
export type ComposerChange = { modelId?: string; reasoningEffort?: string; serviceTier?: string | null; planMode?: boolean };

const defaultEffort = (model: ProviderModelOption) => model.defaultReasoningEffort || model.supportedReasoningEfforts?.[0]?.reasoningEffort || null;
const matches = (model: ProviderModelOption, selection: string | null | undefined) => Boolean(selection && (model.id === selection || model.model === selection));

/** The laptop's model catalog can advertise controls beyond the provider's static defaults. */
export function composerCapabilitiesFor(provider: HarnessProvider, models: readonly ProviderModelOption[]): ProviderCapabilities {
  const capabilities = defaultProviderCapabilities(provider);
  return { ...capabilities, serviceTier: capabilities.serviceTier || models.some(model => Boolean(model.serviceTiers?.length)) };
}

export function resolveComposerSettings(agent: Agent, models: readonly ProviderModelOption[], choice: ComposerChoice | undefined): ComposerSettings {
  const saved = agent.providerDefaults;
  const model = models.find((candidate) => matches(candidate, choice?.model ?? saved?.model)) ?? models.find((candidate) => candidate.isDefault) ?? models[0] ?? null;
  const savedTier = saved && 'serviceTier' in saved ? saved.serviceTier : undefined;
  return {
    provider: agent.provider, model,
    reasoningEffort: choice?.reasoningEffort !== undefined ? choice.reasoningEffort : (saved?.reasoningEffort ?? (model ? defaultEffort(model) : null)),
    serviceTier: choice?.serviceTier !== undefined ? choice.serviceTier : (savedTier ?? model?.defaultServiceTier ?? null),
    planMode: Boolean(choice?.planMode),
  };
}

/** Applies one change from the model menu. `save` is what to persist on the laptop; plan mode stays on the phone. */
export function applyComposerChoice(provider: HarnessProvider, models: readonly ProviderModelOption[], current: ComposerChoice, change: ComposerChange): { choice: ComposerChoice; save: ExecutionSelection | null } {
  const model = models.find((candidate) => matches(candidate, current.model));
  if (change.modelId !== undefined) {
    const next = models.find((candidate) => candidate.id === change.modelId);
    if (!next) return { choice: current, save: null };
    const efforts = next.supportedReasoningEfforts ?? [];
    const reasoningEffort = efforts.some(option => option.reasoningEffort === current.reasoningEffort)
      ? current.reasoningEffort ?? null
      : efforts[Math.floor(efforts.length / 2)]?.reasoningEffort ?? null;
    const choice = { ...current, model: next.model, reasoningEffort, serviceTier: next.defaultServiceTier ?? null };
    return { choice, save: { provider: provider, model: next.model, reasoningEffort: choice.reasoningEffort, serviceTier: choice.serviceTier } };
  }
  if (change.reasoningEffort !== undefined) {
    if (!model?.supportedReasoningEfforts?.some((option) => option.reasoningEffort === change.reasoningEffort)) return { choice: current, save: null };
    const choice = { ...current, reasoningEffort: change.reasoningEffort };
    return { choice, save: { provider: provider, model: model.model, reasoningEffort: change.reasoningEffort, serviceTier: current.serviceTier ?? null } };
  }
  if (change.serviceTier !== undefined) {
    if (!model || (change.serviceTier !== null && !model.serviceTiers?.some((tier) => tier.id === change.serviceTier))) return { choice: current, save: null };
    const choice = { ...current, serviceTier: change.serviceTier };
    return { choice, save: { provider: provider, model: model.model, reasoningEffort: current.reasoningEffort ?? null, serviceTier: change.serviceTier } };
  }
  if (change.planMode !== undefined) return { choice: { ...current, planMode: change.planMode }, save: null };
  return { choice: current, save: null };
}

/** Mirrors the desktop composer: only what the provider supports travels with the prompt. */
export function promptOptionsFor(settings: ComposerSettings, capabilities: Pick<ProviderCapabilities, 'models' | 'reasoningEffort' | 'serviceTier' | 'planMode'>): CompanionPromptOptions | undefined {
  const model = capabilities.models ? settings.model : null;
  const reasoningEffort = capabilities.reasoningEffort && model ? settings.reasoningEffort ?? defaultEffort(model) : null;
  const serviceTier = capabilities.serviceTier && model?.serviceTiers?.length ? settings.serviceTier : undefined;
  const planMode = capabilities.planMode === 'native' ? settings.planMode : capabilities.planMode === 'prompted' && settings.planMode ? true : undefined;
  if (!model && planMode === undefined && !reasoningEffort && serviceTier === undefined) return undefined;
  return { ...((model || reasoningEffort || serviceTier !== undefined) ? { selection: { ...(model ? { model: model.model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(serviceTier !== undefined ? { serviceTier } : {}) } } : {}), ...(planMode === undefined ? {} : { planMode }) };
}
