import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { activeSession, projectMobileGroups } from '../workspace-groups';

const agent = (id: string, patch: Partial<Agent> = {}): Agent => ({ id, teamId: 't', name: id, folder: null, backend: 'codex', status: { type: 'idle' }, createdAt: '', updatedAt: '', ...patch });
const git = (id: string, root: string): Agent => agent(id, { workspace: { kind: 'git', folder: root, repositoryName: 'repo', repositoryRoot: root, primaryWorktreeRoot: '/repo', branch: id, isLinkedWorktree: false, updatedAt: '' } });

describe('mobile workspace groups', () => {
  const agents = [git('main', '/repo'), agent('chat', { sessionKind: 'quickChat', conversationTitle: 'Plan' })];
  it('lists quick chats first and resolves each repository icon', () => {
    const groups = projectMobileGroups(agents, 'main', 'Chats', { '/repo': '⚙️' });
    expect(groups.map((group) => [group.label, group.icon])).toStrictEqual([['Chats', undefined], ['repo', '⚙️']]);
  });
  it('finds the active session with its group, or none', () => {
    const groups = projectMobileGroups(agents, 'main', 'Chats');
    expect(activeSession(groups)).toMatchObject({ group: { label: 'repo' }, session: { agentId: 'main', isActive: true } });
    expect(activeSession(projectMobileGroups(agents, null, 'Chats'))).toBeNull();
  });
});
