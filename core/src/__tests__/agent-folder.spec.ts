import { expect, it } from 'vitest';
import type { Agent } from '../contracts';
import { repositoryPeersForAgent } from '../agent-folder';

it('finds other conversations in the same repository and host across linked worktrees and teams', () => {
  const source = {
    id: 'source', teamId: 'local', folder: '/repo-feature',
    workspace: { kind: 'git', primaryWorktreeRoot: '/repo' },
  } as Agent;
  const main = { ...source, id: 'main', folder: '/repo' };
  const peer = { ...source, id: 'peer', teamId: 'other-local', folder: '/repo-other' };
  const remote = { ...main, id: 'remote', teamId: 'other-local', remoteConnectionId: 'ssh' };
  const otherRepo = { ...main, id: 'other-repo', workspace: { ...source.workspace!, primaryWorktreeRoot: '/another' } } as Agent;
  const snapshot = {
    agents: [source, main, peer, remote, otherRepo, { ...main, id: 'quick', sessionKind: 'quickChat' as const }],
    teams: [
      { id: 'local', name: 'Local', agentIds: [] }, { id: 'other-local', name: 'Other', agentIds: [] },
    ],
  };
  expect(repositoryPeersForAgent(source, snapshot).map(agent => agent.id)).toStrictEqual(['main', 'peer']);
  expect(repositoryPeersForAgent({ ...source, workspace: undefined }, snapshot)).toStrictEqual([]);
  expect(repositoryPeersForAgent(remote, { ...snapshot, agents: [remote, { ...remote, id: 'remote-peer' }, main] }).map(agent => agent.id))
    .toStrictEqual(['remote-peer']);
});
