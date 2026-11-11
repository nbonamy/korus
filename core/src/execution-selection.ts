import type { Agent, ProviderDefaults } from './contracts';
import type { HarnessProvider } from './contracts/shared';
import { isHarnessProvider } from './contracts/shared';
import type { ExecutionSelection, ExecutionSelectionOverrides } from './contracts/execution';

export function defaultExecutionSelection(provider: HarnessProvider): ExecutionSelection {
  return { provider: provider, model: null, reasoningEffort: null, serviceTier: null };
}

export function executionSelectionForAgent(agent: Pick<Agent, 'provider' | 'providerDefaults'>): ExecutionSelection {
  const defaults = agent.providerDefaults?.kind === agent.provider ? agent.providerDefaults : undefined;
  return {
    provider: agent.provider,
    model: defaults?.model ?? null,
    reasoningEffort: defaults?.reasoningEffort ?? null,
    serviceTier: defaults && 'serviceTier' in defaults ? defaults.serviceTier ?? null : null,
  };
}

export function resolveExecutionSelection(base: ExecutionSelection, overrides: ExecutionSelectionOverrides = {}): ExecutionSelection {
  if (overrides.provider !== undefined && overrides.provider !== base.provider) {
    throw new Error('Resolve the target provider defaults before applying execution overrides.');
  }
  return {
    provider: base.provider,
    model: overrides.model === undefined ? base.model : overrides.model,
    reasoningEffort: overrides.reasoningEffort === undefined ? (overrides.model === undefined ? base.reasoningEffort : null) : overrides.reasoningEffort,
    serviceTier: overrides.serviceTier === undefined ? base.serviceTier : overrides.serviceTier,
  };
}

const selectionValue = (value: unknown): boolean => value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 200);
const selectionFields = {
  provider: isHarnessProvider,
  model: selectionValue,
  reasoningEffort: selectionValue,
  serviceTier: selectionValue,
} satisfies Record<keyof ExecutionSelection, (value: unknown) => boolean>;

export function isExecutionSelection(value: unknown): value is ExecutionSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => Object.hasOwn(selectionFields, key))
    && Object.entries(selectionFields).every(([key, validate]) => Object.hasOwn(record, key) && validate(record[key]));
}

export function isExecutionSelectionOverrides(value: unknown): value is ExecutionSelectionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) => Object.hasOwn(selectionFields, key)
    && (entry === undefined || selectionFields[key as keyof ExecutionSelection](entry)));
}

/** Provider defaults remain provider-owned settings; all app work uses the common selection. */
export function applyExecutionSelection(agent: Pick<Agent, 'provider' | 'providerDefaults'>, selection: ExecutionSelection): void {
  if (selection.provider !== agent.provider) throw new Error('Execution selection does not match the agent provider.');
  const { provider, model, reasoningEffort, serviceTier, ...remaining } = selection;
  const exhaustive: Record<string, never> = remaining;
  void exhaustive;
  const defaults: ProviderDefaults = agent.providerDefaults?.kind === provider ? agent.providerDefaults : { kind: provider };
  const { model: _oldModel, reasoningEffort: _oldEffort, serviceTier: _oldTier, userSelectedModel: _oldSelected, ...policy } = defaults;
  agent.providerDefaults = {
    ...policy,
    ...(model ? { model, userSelectedModel: true } : {}),
    ...(provider !== 'antigravity' && reasoningEffort ? { reasoningEffort } : {}),
    ...(provider !== 'antigravity' ? { serviceTier } : {}),
  };
}

/** Saved configurations predate the shared contract; runtime requests use the strict guards. */
export function readPersistedExecutionSelection(value: unknown, backend?: HarnessProvider): ExecutionSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const provider = record.provider ?? backend;
  const selection = {
    provider: provider,
    model: record.model ?? null,
    reasoningEffort: record.reasoningEffort ?? null,
    serviceTier: record.serviceTier ?? null,
  } satisfies Record<keyof ExecutionSelection, unknown>;
  return isExecutionSelection(selection) && (!backend || backend === selection.provider) ? selection : undefined;
}

export function hasExecutionOverrides(selection: ExecutionSelectionOverrides | undefined): boolean {
  return Boolean(selection && Object.entries(selection).some(([key, value]) => key !== 'provider' && value !== undefined));
}
