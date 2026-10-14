import type { CompanionWorkspace } from './companion-port';

/**
 * The laptop repeats its whole workspace on every update. Parts that did not change keep their previous
 * objects (and an unchanged workspace is the previous one), so nothing derived from them is recomputed or resent.
 */
export function reconcileWorkspace(previous: CompanionWorkspace, next: CompanionWorkspace): CompanionWorkspace {
  if (previous === next) return previous;
  const same = <Value>(old: Value, current: Value): Value => (old === current || JSON.stringify(old) === JSON.stringify(current) ? old : current);
  const items = <Item extends { id: string }>(old: readonly Item[] | undefined, current: readonly Item[]): readonly Item[] => {
    const known = new Map((old ?? []).map((item) => [item.id, item]));
    const merged = current.map((item) => { const before = known.get(item.id); return before ? same(before, item) : item; });
    return old && old.length === merged.length && merged.every((item, index) => item === old[index]) ? old : merged;
  };
  const merged = { ...next, teams: items(previous.teams, next.teams) as CompanionWorkspace['teams'], agents: items(previous.agents, next.agents) as CompanionWorkspace['agents'] };
  for (const key of ['repositoryIcons', 'modelFavorites', 'agentRequests', 'backends'] as const) {
    if (key in next && key in previous) (merged as Record<string, unknown>)[key] = same(previous[key], next[key]);
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(merged)]) as Set<keyof CompanionWorkspace>;
  return [...keys].every((key) => previous[key] === merged[key]) ? previous : merged;
}
