import { describe, expect, it } from 'vitest';
import type { Agent } from '../contracts';
import type { AppSnapshot } from '../contracts';
import { companionWorkspaceOf, projectCompanionWorkspace } from '../companion-projection';
import { projectWorkspaceSidebar } from '../workspace-sidebar';

const now = '2026-01-01T00:00:00Z';
function agent(id: string, patch: Partial<Agent>): Agent {
  return { id, teamId: 'team', name: null, folder: null, backend: 'codex', status: { type: 'idle' }, createdAt: now, updatedAt: now, ...patch };
}
function git(id: string, root: string, branch: string | null, patch: Partial<Agent> = {}, linked = false): Agent {
  return agent(id, { folder: root, workspace: { kind: 'git', folder: root, repositoryName: 'codex-app-sdk', repositoryRoot: root, primaryWorktreeRoot: '/Users/me/src/codex-app-sdk',
    branch, defaultBranch: 'main', isLinkedWorktree: linked, originUrl: 'git@github.com:me/codex-app-sdk.git', updatedAt: now }, ...patch });
}
const teams = [{ id: 'team', name: 'Korus', agentIds: [] }];
const sidebar = (projected: ReturnType<typeof projectCompanionWorkspace>) => projectWorkspaceSidebar({ agents: projected.agents, activeAgentId: null, quickChatsLabel: 'Chats' });

describe('companion workspace projection', () => {
  const agents = [
    git('sdk', '/Users/me/src/codex-app-sdk-sdk', 'sdk', {}, true),
    git('builder', '/Users/me/src/codex-app-sdk-builder', 'app-builder', {}, true),
    git('sherpa', '/Users/me/src/codex-app-sdk', 'main', { name: 'Sherpa', conversationTitle: 'Sherpa helper lifecycle' }),
    agent('chat', { sessionKind: 'quickChat', conversationTitle: 'Plan the trip' }),
    agent('docs', { folder: '/Users/me/notes', workspace: { kind: 'folder', folder: '/Users/me/notes', label: 'notes', updatedAt: now } }),
  ];
  const icons = { 'remote:github.com/me/codex-app-sdk': 'data:image/png;base64,GEAR', '/Users/me/src/codex-app-sdk': 'GEAR-ROOT' };
  const projected = projectCompanionWorkspace({ teams, agents, repositoryIcons: icons });

  it('lets the phone rebuild the desktop sidebar: repositories, branch titles and conversation titles', () => {
    const groups = sidebar(projected);
    const repository = groups.find((group) => group.kind === 'repository')!;
    expect(repository.label).toBe('codex-app-sdk');
    expect(repository.sessions.map((session) => [session.agentId, session.displayTitle, session.kind])).toStrictEqual([
      ['sdk', 'sdk', 'worktree'], ['builder', 'app-builder', 'worktree'], ['sherpa', 'Sherpa helper lifecycle', 'main']]);
    expect(groups.find((group) => group.kind === 'quickChats')!.sessions[0]!.displayTitle).toBe('Plan the trip');
    expect(groups.find((group) => group.kind === 'folder')!.label).toBe('notes');
  });
  it('sends one icon per repository, keyed so the sidebar projection finds it', () => {
    const repository = sidebar(projected).find((group) => group.kind === 'repository')!;
    expect(Object.keys(projected.repositoryIcons)).toStrictEqual([repository.repositoryKey]);
    expect(projected.repositoryIcons[repository.repositoryKey!]).toBe('data:image/png;base64,GEAR');
  });
  it('never exposes a local path or remote URL, while keeping groups and labels stable', () => {
    const wire = JSON.stringify(projected);
    expect(wire).not.toContain('/Users/me');
    expect(wire).not.toContain('github.com');
    expect(wire).toContain('"label":"notes"');
    expect(projectCompanionWorkspace({ teams, agents, repositoryIcons: icons })).toStrictEqual(projected);
  });
  it('shares model favorites with the workspace', () => {
    const favorites = [{ backend: 'codex' as const, modelId: 'gpt', reasoningEffort: 'high', serviceTier: null }];
    expect(projectCompanionWorkspace({ teams, agents: [], modelFavorites: favorites }).modelFavorites).toStrictEqual(favorites);
    expect(projectCompanionWorkspace({ teams, agents: [] }).modelFavorites).toStrictEqual([]);
  });
  it('shares the last model and permission choice but no sandbox or approval policy', () => {
    const [first] = projectCompanionWorkspace({ teams, repositoryIcons: {}, agents: [agent('a', { backendDefaults: { kind: 'codex', model: 'gpt', reasoningEffort: 'high', serviceTier: 'fast', approvalPreset: 'full-access', approvalPolicy: 'never', sandboxMode: 'danger-full-access' } })] }).agents;
    expect(first!.backendDefaults).toStrictEqual({ kind: 'codex', model: 'gpt', reasoningEffort: 'high', serviceTier: 'fast', approvalPreset: 'full-access' });
  });
  it('keeps only presentation fields', () => {
    const [first] = projectCompanionWorkspace({ teams, agents: [{ ...agents[0]!, mcpSessionId: 'private' } as Agent], repositoryIcons: {} }).agents;
    expect(first).not.toHaveProperty('mcpSessionId');
    const allowed = ['id', 'teamId', 'name', 'avatar', 'backend', 'backendSession', 'status', 'statusText', 'createdAt', 'updatedAt', 'sessionKind', 'conversationTitle', 'workspace', 'folder', 'backendDefaults'];
    expect(Object.keys(first!).every((key) => allowed.includes(key))).toBe(true);
  });

  it('leaves mission-owned workers out of the list, like the desktop sidebar', () => {
    const missions = [{ execution: { runs: [{ workerId: 'worker' }, {}] } }] as unknown as AppSnapshot['missions'];
    const workspace = companionWorkspaceOf({ teams, agents: [agent('keep', {}), agent('worker', {})], general: { repositoryIcons: { a: 'b' }, modelFavorites: [] } as unknown as AppSnapshot['general'], missions });
    expect(workspace.agents.map((candidate) => candidate.id)).toStrictEqual(['keep']);
    expect(workspace.repositoryIcons).toStrictEqual({ a: 'b' });
    expect(companionWorkspaceOf({ teams, agents: [agent('keep', {})], general: { repositoryIcons: {} } as unknown as AppSnapshot['general'] }).agents).toHaveLength(1);
  });
});
