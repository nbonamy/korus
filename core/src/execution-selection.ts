import type { Agent, BackendDefaults } from './contracts';
import type { AgentBackend } from './contracts/shared';
import { isAgentBackend } from './contracts/shared';
import type { ExecutionSelection, ExecutionSelectionOverrides } from './contracts/execution';

export function defaultExecutionSelection(backend: AgentBackend): ExecutionSelection {
  return { backend, model: null, reasoningEffort: null, serviceTier: null };
}

export function executionSelectionForAgent(agent: Pick<Agent, 'backend' | 'backendDefaults'>): ExecutionSelection {
  const defaults = agent.backendDefaults?.kind === agent.backend ? agent.backendDefaults : undefined;
  return {
    backend: agent.backend,
    model: defaults?.model ?? null,
    reasoningEffort: defaults?.reasoningEffort ?? null,
    serviceTier: defaults && 'serviceTier' in defaults ? defaults.serviceTier ?? null : null,
  };
}

export function resolveExecutionSelection(base: ExecutionSelection, overrides: ExecutionSelectionOverrides = {}): ExecutionSelection {
  if (overrides.backend !== undefined && overrides.backend !== base.backend) {
    throw new Error('Resolve the target provider defaults before applying execution overrides.');
  }
  return {
    backend: base.backend,
    model: overrides.model === undefined ? base.model : overrides.model,
    reasoningEffort: overrides.reasoningEffort === undefined ? (overrides.model === undefined ? base.reasoningEffort : null) : overrides.reasoningEffort,
    serviceTier: overrides.serviceTier === undefined ? base.serviceTier : overrides.serviceTier,
  };
}

const selectionValue = (value: unknown): boolean => value === null || (typeof value === 'string' && value.trim().length > 0 && value.length <= 200);
const selectionFields = {
  backend: isAgentBackend,
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
export function applyExecutionSelection(agent: Pick<Agent, 'backend' | 'backendDefaults'>, selection: ExecutionSelection): void {
  if (selection.backend !== agent.backend) throw new Error('Execution selection does not match the agent provider.');
  const { backend, model, reasoningEffort, serviceTier, ...remaining } = selection;
  const exhaustive: Record<string, never> = remaining;
  void exhaustive;
  const defaults: BackendDefaults = agent.backendDefaults?.kind === backend ? agent.backendDefaults : { kind: backend };
  const { model: _oldModel, reasoningEffort: _oldEffort, serviceTier: _oldTier, userSelectedModel: _oldSelected, ...policy } = defaults;
  agent.backendDefaults = {
    ...policy,
    ...(model ? { model, userSelectedModel: true } : {}),
    ...(backend !== 'antigravity' && reasoningEffort ? { reasoningEffort } : {}),
    ...(backend !== 'antigravity' ? { serviceTier } : {}),
  };
}

/** Saved configurations predate the shared contract; runtime requests use the strict guards. */
export function readPersistedExecutionSelection(value: unknown, backend?: AgentBackend): ExecutionSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const provider = record.backend ?? backend;
  const selection = {
    backend: provider,
    model: record.model ?? null,
    reasoningEffort: record.reasoningEffort ?? null,
    serviceTier: record.serviceTier ?? null,
  } satisfies Record<keyof ExecutionSelection, unknown>;
  return isExecutionSelection(selection) && (!backend || backend === selection.backend) ? selection : undefined;
}

export function hasExecutionOverrides(selection: ExecutionSelectionOverrides | undefined): boolean {
  return Boolean(selection && Object.entries(selection).some(([key, value]) => key !== 'backend' && value !== undefined));
}
