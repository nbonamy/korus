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
function migrateRemoteTeamLinks(value: unknown): unknown {
  if (!record(value) || !Array.isArray(value.teams)) return value;
  return { ...value, teams: value.teams.map(team => {
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
