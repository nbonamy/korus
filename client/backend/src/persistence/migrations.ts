import { StoreFormatError } from './store-format';

export type Migration<From = unknown, To = unknown> = {
  readonly from: number;
  readonly to: number;
  up(value: From): To;
};

/** Envelope upgrades preserve data while excluding readers that cannot retain its configuration. */
export const rosterMigrations: readonly Migration[] = [
  { from: 1, to: 2, up: (value: unknown) => value },
  { from: 2, to: 3, up: migrateExecutionSelections },
  { from: 3, to: 4, up: migrateRemoteTeamLinks },
  { from: 4, to: 5, up: (value: unknown) => renameProviderFields(value) },
];

/** Settings, tasks and visualizations share one envelope version. */
export const storeMigrations: readonly Migration[] = [
  { from: 1, to: 2, up: (value: unknown) => renameProviderFields(value) },
];

/**
 * Applies contiguous steps until `target`. A step is written against the frozen
 * shape of its own version, never against the live contracts.
 */
export function migrateData(file: string, data: unknown, version: number, target: number, steps: readonly Migration[]): unknown {
  let current = data;
  let at = version;
  while (at < target) {
    const step = steps.find((candidate) => candidate.from === at);
    if (!step || step.to !== at + 1) {
      throw new StoreFormatError(`${file}: no migration from schema ${at} to ${at + 1}.`);
    }
    current = step.up(current);
    at = step.to;
  }
  return current;
}

// Frozen schema-2 input: keep unknown entities and provider blocks untouched.
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Frozen schema-3 teams: a remote pointer becomes one link to the same foreign team.
export function migrateRemoteTeamLinks(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.teams)) return value;
  const pointerTeams = new Set(value.teams.filter(team => record(team) && typeof team.remoteConnectionId === 'string' && typeof team.remoteTeamId === 'string').map(team => (team as Record<string, unknown>).id));
  const foreignIds = new Set<unknown>();
  for (const team of value.teams) if (record(team) && pointerTeams.has(team.id) && Array.isArray(team.agentIds)) for (const id of team.agentIds) foreignIds.add(id);
  if (Array.isArray(value.agents)) for (const agent of value.agents) if (record(agent) && pointerTeams.has(agent.teamId)) foreignIds.add(agent.id);
  const retain = (items: unknown) => record(items) ? Object.fromEntries(Object.entries(items).filter(([id]) => !foreignIds.has(id))) : items;
  const assignments = (items: unknown) => record(items) ? Object.fromEntries(Object.entries(items).filter(([, row]) => !record(row) || !foreignIds.has(row.agentId))) : items;
  return { ...value,
    ...(Array.isArray(value.agents) ? { agents: value.agents.filter(agent => !record(agent) || !foreignIds.has(agent.id)) } : {}),
    ...(value.workAssignments ? { workAssignments: assignments(value.workAssignments) } : {}),
    ...(record(value.workBacklog) ? { workBacklog: { ...value.workBacklog, assignments: assignments(value.workBacklog.assignments) } } : {}),
    ...(value.subagents ? { subagents: retain(value.subagents) } : {}),
    ...(value.subagentTrees ? { subagentTrees: retain(value.subagentTrees) } : {}),
    ...(foreignIds.has(value.activeAgentId) ? { activeAgentId: null } : {}),
    teams: value.teams.map(raw => {
    const team = record(raw) ? { ...raw, ...(Array.isArray(raw.agentIds) ? { agentIds: raw.agentIds.filter(id => !foreignIds.has(id)) } : {}), ...(foreignIds.has(raw.activeAgentId) ? { activeAgentId: undefined } : {}) } : raw;
    if (!record(team)) return team;
    const { remoteConnectionId, remoteTeamId, ...rest } = team;
    if (Array.isArray(rest.remoteLinks) || typeof remoteConnectionId !== 'string' || typeof remoteTeamId !== 'string') return rest;
    return { ...rest, remoteLinks: [{ connectionId: remoteConnectionId, remoteTeamId }] };
  }) };
}
function migrateExecutionSelections(value: unknown): unknown {
  if (!record(value)) return value;
  const rows = (items: unknown, map: (row: Record<string, unknown>) => unknown) => Array.isArray(items) ? items.map(row => record(row) ? map(row) : row) : items;
  return {
    ...value,
    automations: rows(value.automations, row => {
      const target = row.target;
      if (!record(target) || target.kind !== 'newQuickChat' || target.selection !== undefined) return row;
      const { backend, model, reasoningEffort, serviceTier, ...rest } = target;
      return { ...row, target: { ...rest, selection: { backend,
        ...(model === undefined ? {} : { model }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }), ...(serviceTier === undefined ? {} : { serviceTier }) } } };
    }),
    ...(Array.isArray(value.missions) ? { missions: rows(value.missions, row => {
      const execution = row.execution;
      if (!record(execution) || !record(execution.implementationModel)) return row;
      return { ...row, execution: { ...execution, implementationModel: { reasoningEffort: null, serviceTier: null, ...execution.implementationModel } } };
    }) } : {}),
    agents: rows(value.agents, row => {
      if (!record(row.handoff) || row.handoff.selection !== undefined) return row;
      const { backend, model, ...handoff } = row.handoff;
      return { ...row, handoff: { ...handoff, selection: { backend, model: model ?? null, reasoningEffort: null, serviceTier: null } } };
    }),
  };
}

const providerKinds = new Set(['codex', 'claude', 'cursor', 'antigravity']);
const providerFieldNames: Readonly<Record<string, string>> = {
  backendSession: 'providerSession',
  backendDefaults: 'providerDefaults',
  backendSessionId: 'providerSessionId',
  backendOptions: 'providerOptions',
};

/**
 * Schema 5 (roster) and store schema 2 (settings, tasks, visualizations): the agent provider was
 * stored under `backend*` keys and is stored under `provider*` keys. A `backend` key is only
 * renamed when it names a provider, and no key is ever overwritten. Applies to every stored
 * document, at any depth, and is safe to run twice.
 */
export function renameProviderFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameProviderFields);
  if (!record(value)) return value;
  const target = (key: string, entry: unknown): string => {
    const renamed = key === 'backend' && typeof entry === 'string' && providerKinds.has(entry) ? 'provider' : providerFieldNames[key];
    return renamed !== undefined && !(renamed in value) ? renamed : key;
  };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [target(key, entry), renameProviderFields(entry)]));
}
