import { describe, expect, it } from 'vitest';
import type { Agent, AppSnapshot } from '../contracts';
import { createInitialSnapshot } from '../snapshot';
import { orderFeatureBranches, reorderFeature } from '../feature-groups';

function teamWith(branches: string[]): { snapshot: AppSnapshot; teamId: string } {
  const snapshot = createInitialSnapshot();
  const team = snapshot.teams[0]!;
  snapshot.agents = branches.map((branch, index): Agent => ({
    ...snapshot.agents[0]!,
    id: `agent-${index}`,
    teamId: team.id,
    workspace: {
      kind: 'git', folder: `/src/${index}`, repositoryName: 'app', repositoryRoot: `/src/${index}`, branch,
      defaultBranch: 'main', isLinkedWorktree: branch !== 'main', primaryWorktreeRoot: '/src/app', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }));
  team.agentIds = snapshot.agents.map(agent => agent.id);
  return { snapshot, teamId: team.id };
}

describe('feature order', () => {
  it('lists saved branches first, then the others as they come', () => {
    expect(orderFeatureBranches(['a', 'b', 'c'], ['c', 'gone', 'a'])).toStrictEqual(['c', 'a', 'b']);
    expect(orderFeatureBranches(['a', 'b'], undefined)).toStrictEqual(['a', 'b']);
  });

  it('moves a feature before another one or to the end, and saves the order on the team', () => {
    const { snapshot, teamId } = teamWith(['main', 'a', 'b', 'c']);
    reorderFeature(snapshot, teamId, 'c', 'a');
    expect(snapshot.teams[0]!.featureOrder).toStrictEqual(['c', 'a', 'b']);
    reorderFeature(snapshot, teamId, 'c', null);
    expect(snapshot.teams[0]!.featureOrder).toStrictEqual(['a', 'b', 'c']);
  });

  it('never orders the default branch or an unknown feature', () => {
    const { snapshot, teamId } = teamWith(['main', 'a']);
    expect(() => reorderFeature(snapshot, teamId, 'main', null)).toThrow('Feature not found.');
    expect(() => reorderFeature(snapshot, teamId, 'a', 'main')).toThrow('Feature not found.');
    expect(() => reorderFeature(snapshot, teamId, 'gone', null)).toThrow('Feature not found.');
  });
});
