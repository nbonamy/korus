import type { Team } from '@workspace/core/contracts';

/** Resolve persisted creator lineage without changing provider/task execution identity. */
export function resolveHandoffAgentId(teams: readonly Team[], id: string): string {
  const visited = new Set<string>();
  let current = id;
  while (!visited.has(current)) {
    visited.add(current);
    const next = teams.find(team => team.delegationHandoffs?.[current]?.targetAgentId)?.delegationHandoffs?.[current]?.targetAgentId;
    if (!next) break;
    current = next;
  }
  return current;
}
