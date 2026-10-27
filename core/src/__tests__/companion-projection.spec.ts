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
  it('shares Git counts and desktop scopes without host paths or eager diff contents', () => {
    const summary = { changedFiles: 2, addedLines: 7, removedLines: 3 };
    const catalog = { defaultTarget: { type: 'uncommitted' as const }, uncommitted: summary, staged: summary,
      unstaged: summary, branch: { ...summary, baseRef: 'origin/main' }, commits: [{ ...summary, sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'A commit' }] };
    const source = companionWorkspaceOf({ teams, agents: [git('a', '/Users/me/work', 'feature')], general: {} as AppSnapshot['general'],
      agentGitStatuses: { a: { folder: '/Users/me/work', repository: '/Users/me', branch: 'feature', ahead: 1, behind: 0,
        ...summary, hasUntracked: true, state: 'dirty', diffCatalog: catalog, updatedAt: now, error: '/Users/me/private' } },
      turnGitDiffs: { turn: { agentId: 'a', turnId: 'turn', addedLines: 4, removedLines: 1, diff: 'private patch', updatedAt: now } },
    });
    const wire = projectCompanionWorkspace(source);
    expect(wire.gitStatuses).toStrictEqual({ a: { branch: 'feature', state: 'dirty', ...summary, diffCatalog: catalog,
      lastTurn: { turnId: 'turn', addedLines: 4, removedLines: 1 } } });
    expect(JSON.stringify(wire.gitStatuses)).not.toContain('/Users/me');
    expect(JSON.stringify(wire.gitStatuses)).not.toContain('private patch');
  });
  it('shares queued text for visible agents without prompt options or attachment paths', () => {
    const workspace = companionWorkspaceOf({ teams, agents: [agent('keep', {}), agent('worker', {})], general: {} as AppSnapshot['general'],
      queuedPrompts: ['keep', 'worker', 'missing'].map(agentId => ({ id: agentId, agentId, text: 'Follow up', createdAt: now, options: { attachments: [{ type: 'file' as const, name: 'note.txt', path: '/private/note.txt' }] } })),
      missions: [{ execution: { runs: [{ workerId: 'worker' }] } }] as unknown as AppSnapshot['missions'] });
    expect(projectCompanionWorkspace(workspace).queuedPrompts).toStrictEqual([{ id: 'keep', agentId: 'keep', text: 'Follow up' }]);
    expect(projectCompanionWorkspace({ teams, agents: [] }).queuedPrompts).toStrictEqual([]);
  });
  it('includes the same read revision used by the desktop', () => {
    const readState = { revision: 7, readRevision: 5 };
    const projected = projectCompanionWorkspace({ teams, agents: [agent('readable', { readState })] });
    expect(projected.agents[0]!.readState).toStrictEqual(readState);
  });
  it('includes pending requests only for agents visible to the phone', () => {
    const request = { id: 'approval', conversationId: 'thread', kind: 'approval' as const,
      approval: { id: 'approval', conversationId: 'thread', itemId: 'command', kind: 'command' as const, title: 'Run command', command: 'git status', allowedScopes: ['once' as const] } };
    const workspace = companionWorkspaceOf({ teams, agents: [agent('keep', {}), agent('worker', {})],
      general: {} as AppSnapshot['general'], agentRequests: { keep: [request], worker: [request], missing: [request] },
      missions: [{ execution: { runs: [{ workerId: 'worker' }] } }] as unknown as AppSnapshot['missions'] });
    expect(projectCompanionWorkspace(workspace).agentRequests).toStrictEqual({ keep: [request] });
  });

  describe('missions', () => {
    const ticket = (title: string, patch: Record<string, unknown> = {}) => ({ title, done: false, ...patch });
    const run = (ticketIndex: number, status: string, workerId?: string, startedAt = '2026-01-01T00:30:00Z') => ({ id: `run-${ticketIndex}-${status}`, stage: 'implementation', ticketIndex, status, startedAt, ...(workerId ? { workerId } : {}) });
    const mission = (id: string, patch: Record<string, unknown> = {}) => ({ id, teamId: 'team', outcome: 'Ship it', stage: 'implementation', status: 'active', revision: 3, createdAt: '2025-12-31T00:00:00Z', updatedAt: now,
      artifacts: { tickets: [] }, execution: { runs: [] }, ...patch });
    const source = (missions: unknown[], agents: Agent[] = []) => companionWorkspaceOf({ teams, agents, general: {} as AppSnapshot['general'], missions: missions as AppSnapshot['missions'] });

    it('reports each ticket the way the desktop board does, with the worker of one that has run', () => {
      const workspace = projectCompanionWorkspace(source([mission('m', {
        artifacts: { tickets: [ticket('Done', { done: true }), ticket('Going', { dependsOn: [0], repositoryPath: '/Users/me/src/billing-service' }), ticket('Waiting', { dependsOn: [1] }), ticket('Free'), ticket('Retried')] },
        execution: { runs: [run(1, 'running', 'w1'), run(4, 'failed', 'old'), run(4, 'awaitingReview', 'w4')] },
      })], [agent('w1', {}), agent('old', {}), agent('w4', {}), agent('chat', {})]));
      expect(workspace.missionProgress).toStrictEqual([{ id: 'm', teamId: 'team', outcome: 'Ship it', stage: 'implementation', status: 'active', revision: 3, startedAt: '2026-01-01T00:30:00Z', updatedAt: now, tickets: [
        { number: 1, title: 'Done', state: 'accepted' }, { number: 2, title: 'Going', repository: 'billing-service', state: 'running', agentId: 'w1' }, { number: 3, title: 'Waiting', state: 'blocked', after: [2] },
        { number: 4, title: 'Free', state: 'queued' }, { number: 5, title: 'Retried', state: 'awaitingReview', agentId: 'w4', runId: 'run-4-awaitingReview' }] }]);
    });
    it('keeps ticket workers out of the agent list but lets the phone open them and answer their requests', () => {
      const request = { id: 'ask', conversationId: 'thread', kind: 'approval' as const,
        approval: { id: 'ask', conversationId: 'thread', itemId: 'command', kind: 'command' as const, title: 'Run command', command: 'git status', allowedScopes: ['once' as const] } };
      const workspace = projectCompanionWorkspace(companionWorkspaceOf({ teams, general: {} as AppSnapshot['general'], agentRequests: { w1: [request], old: [request] },
        agents: [agent('w1', { folder: '/Users/me/work' }), agent('old', {}), agent('chat', {})],
        missions: [mission('m', { artifacts: { tickets: [ticket('Going')] }, execution: { runs: [run(0, 'failed', 'old'), run(0, 'running', 'w1')] } })] as unknown as AppSnapshot['missions'] }));
      expect(workspace.agents.map(({ id }) => id)).toStrictEqual(['chat']);
      expect(workspace.missionAgents.map(({ id }) => id)).toStrictEqual(['w1']);
      expect(workspace.missionAgents[0]!.folder).not.toContain('/Users/me');
      expect(workspace.agentRequests).toStrictEqual({ chat: [], w1: [request] });
    });
    it('shows completed missions after the active ones, and no more than the most recent twenty', () => {
      const dated = (id: string, minutes: number, status: 'active' | 'completed') => mission(id, { status, updatedAt: new Date(Date.parse(now) + minutes * 60_000).toISOString() });
      const many = [dated('done-new', 99, 'completed'), dated('active-old', 0, 'active'), ...Array.from({ length: 25 }, (_, index) => dated(`done-${index}`, index, 'completed'))];
      const ids = projectCompanionWorkspace(source(many)).missionProgress.map(({ id }) => id);
      expect(ids).toHaveLength(20);
      expect(ids.slice(0, 2)).toStrictEqual(['active-old', 'done-new']);
    });
    it('dates a mission from its first implementation run, or from its creation before any run', () => {
      const [started, idle] = projectCompanionWorkspace(source([
        mission('started', { artifacts: { tickets: [ticket('A'), ticket('B')] }, execution: { runs: [run(1, 'running', 'w', '2026-01-01T02:00:00Z'), run(0, 'accepted', 'x', '2026-01-01T01:00:00Z')] } }),
        mission('idle')])).missionProgress.sort((a, b) => a.id === 'started' ? -1 : 1);
      expect(started!.startedAt).toBe('2026-01-01T01:00:00Z');
      expect(idle!.startedAt).toBe('2025-12-31T00:00:00Z');
    });
    it('names the mission lead without mistaking an implementation worker for it', () => {
      const lead = (patch: Record<string, unknown>) => projectCompanionWorkspace(source([mission('m', patch)])).missionProgress[0]!.leadAgentId;
      expect(lead({ stage: 'implementation', stageAgentIds: { requirements: 'req', tickets: 'tix', implementation: 'impl' } })).toBe('tix');
      expect(lead({ stage: 'review', stageAgentIds: { requirements: 'req', tickets: 'tix', implementation: 'impl' } })).toBe('tix');
      expect(lead({ stage: 'review', stageAgentIds: { tickets: 'tix', review: 'reviewer' } })).toBe('reviewer');
      expect(lead({ stage: 'review', stageAgentIds: { requirements: 'req', tickets: 'tix' } })).toBe('tix');
      expect(lead({ stage: 'requirements', stageAgentIds: {} })).toBeUndefined();
    });
    it('says what a person can do next: review once implementation is complete, ship once the review is', () => {
      const artifacts = (patch: Record<string, unknown> = {}) => ({ tickets: [ticket('A', { done: true })], requirements: { problem: 'p', acceptance: 'a' }, implementation: { changes: 'c', tests: 't' }, review: { summary: '', pullRequestUrl: '' }, ...patch });
      const next = (patch: Record<string, unknown>) => projectCompanionWorkspace(source([mission('m', patch)])).missionProgress[0]!.next;
      expect(next({ stage: 'implementation', artifacts: artifacts() })).toBe('review');
      // Tickets done but the implementation record missing, or a ticket still open, is not ready.
      expect(next({ stage: 'implementation', artifacts: artifacts({ implementation: { changes: '', tests: '' } }) })).toBeUndefined();
      expect(next({ stage: 'implementation', artifacts: artifacts({ tickets: [ticket('A')] }) })).toBeUndefined();
      expect(next({ stage: 'review', artifacts: artifacts() })).toBeUndefined();
      expect(next({ stage: 'review', artifacts: artifacts({ review: { summary: 'Looks good', pullRequestUrl: '' } }) })).toBe('ship');
      expect(next({ stage: 'ship', artifacts: artifacts() })).toBe('ship');
      expect(next({ stage: 'ship', status: 'completed', artifacts: artifacts() })).toBeUndefined();
    });
    it('lets the phone open a lead that is itself a mission worker, without listing it among the agents', () => {
      const workspace = projectCompanionWorkspace(source([mission('m', { stage: 'review', stageAgentIds: { review: 'lead' }, execution: { runs: [{ id: 'run', stage: 'review', status: 'running', workerId: 'lead', startedAt: now }] } })],
        [agent('lead', {}), agent('chat', {})]));
      expect(workspace.missionProgress[0]!.leadAgentId).toBe('lead');
      expect(workspace.agents.map(({ id }) => id)).toStrictEqual(['chat']);
      expect(workspace.missionAgents.map(({ id }) => id)).toStrictEqual(['lead']);
    });
    it('shares a review\'s findings and what became of them without host paths', () => {
      const finding = (id: string, patch: Record<string, unknown> = {}) => ({ id, priority: 'p1', title: `Finding ${id}`, body: 'Why it matters.', repositoryPath: '/Users/me/src/korus',
        location: { file: '/Users/me/src/korus/auth/session.ts', line: 142, endLine: 150 }, selected: false, remediation: { state: 'open' }, createdAt: now, updatedAt: now, ...patch });
      const review = projectCompanionWorkspace(source([mission('m', { stage: 'review', artifacts: { tickets: [], review: { summary: 'Two issues', pullRequestUrl: '', findings: [
        finding('a', { selected: true }), finding('b', { priority: 'p3', location: undefined, remediation: { state: 'fixed', completedAt: now } }), finding('c', { remediation: { state: 'fixing', startedAt: now } })] } } })])).missionProgress[0]!.review!;
      expect(review.summary).toBe('Two issues');
      expect(review.findings[0]).toStrictEqual({ id: 'a', priority: 'p1', title: 'Finding a', body: 'Why it matters.', repository: 'korus', file: 'auth/session.ts', line: 142, endLine: 150, selected: true, state: 'open' });
      expect(review.findings.map(({ state }) => state)).toStrictEqual(['open', 'fixed', 'fixing']);
      expect(review.findings[1]).not.toHaveProperty('file');
      expect(JSON.stringify(review)).not.toContain('/Users/me');
      // A mission with nothing reviewed yet sends no review at all.
      expect(projectCompanionWorkspace(source([mission('empty', { artifacts: { tickets: [], review: { summary: '', pullRequestUrl: '', findings: [] } } })])).missionProgress[0]).not.toHaveProperty('review');
    });
    it('enables finding remediation only after the latest review has submitted its result', () => {
      const artifacts = { tickets: [], review: { summary: 'Findings are arriving', findings: [] } };
      const submitted = { id: 'review-1', stage: 'review', status: 'awaitingReview', workerId: 'reviewer', proposal: { review: { summary: 'Submitted review' } } };
      const ready = (runs: unknown[], patch = {}) => projectCompanionWorkspace(source([mission('m', {
        stage: 'review', artifacts, execution: { runs }, ...patch,
      })])).missionProgress[0]!.review!.ready;
      expect(ready([])).toBe(false);
      expect(ready([submitted])).toBe(true);
      // A submitted review with no findings still needs an explicit acceptance action.
      const empty = projectCompanionWorkspace(source([mission('m', { stage: 'review',
        artifacts: { tickets: [], review: { summary: '', findings: [] } }, execution: { runs: [submitted] },
      })])).missionProgress[0]!.review;
      expect(empty).toStrictEqual({ summary: 'Submitted review', findings: [], ready: true, runId: 'review-1' });
      for (const status of ['preparing', 'running', 'failed', 'cancelled']) {
        expect(ready([submitted, { ...submitted, id: 'review-2', status }])).toBe(false);
      }
      expect(ready([{ ...submitted, proposal: undefined }])).toBe(false);
      expect(ready([{ ...submitted, workerId: undefined }])).toBe(false);
      expect(ready([submitted], { stage: 'ship' })).toBe(false);
      expect(ready([submitted], { status: 'completed' })).toBe(false);
    });
    it('omits missions of teams the phone cannot see', () => {
      expect(projectCompanionWorkspace(source([mission('elsewhere', { teamId: 'other' })])).missionProgress).toStrictEqual([]);
    });
  });

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
      ['sdk', 'sdk', 'worktree'], ['builder', 'app-builder', 'worktree'], ['sherpa', 'Sherpa', 'main']]);
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
    const [first] = projectCompanionWorkspace({ teams, agents: [{ ...agents[0]!, suggestedPrompt: 'Run the tests', mcpSessionId: 'private' } as Agent], repositoryIcons: {} }).agents;
    expect(first).not.toHaveProperty('mcpSessionId');
    expect(first!.suggestedPrompt).toBe('Run the tests');
    const allowed = ['id', 'teamId', 'name', 'avatar', 'backend', 'backendSession', 'status', 'statusText', 'createdAt', 'updatedAt', 'sessionKind', 'conversationTitle', 'workspace', 'folder', 'backendDefaults', 'hasSubmittedPrompt', 'suggestedPrompt'];
    expect(Object.keys(first!).every((key) => allowed.includes(key))).toBe(true);
  });

  it('leaves mission-owned workers out of the list, like the desktop sidebar', () => {
    const missions = [{ execution: { runs: [{ workerId: 'worker' }, {}] } }] as unknown as AppSnapshot['missions'];
    const workspace = companionWorkspaceOf({ teams, agents: [agent('keep', {}), agent('worker', {})], general: { repositoryIcons: { a: 'b' }, modelFavorites: [] } as unknown as AppSnapshot['general'], missions });
    expect(workspace.agents.map((candidate) => candidate.id)).toStrictEqual(['keep']);
    expect(workspace.repositoryIcons).toStrictEqual({ a: 'b' });
    expect(companionWorkspaceOf({ teams, agents: [agent('keep', {})], general: { repositoryIcons: {} } as unknown as AppSnapshot['general'] }).agents).toHaveLength(1);
  });
  it('lists, per team, the engines its laptop can start work with', () => {
    const connection = (backend: string, connected = true) => ({ backend, installed: true, connected });
    const workspace = companionWorkspaceOf({
      teams: [{ id: 'local', name: 'Local', agentIds: [] }, { id: 'remote', name: 'Remote', agentIds: [], remoteConnectionId: 'box' }, { id: 'down', name: 'Down', agentIds: [], remoteConnectionId: 'off' }],
      agents: [], general: { repositoryIcons: {}, modelFavorites: [] } as unknown as AppSnapshot['general'],
      providerConnections: [connection('codex'), connection('claude', false)] as unknown as AppSnapshot['providerConnections'],
      remoteConnections: { connections: [{ id: 'box', status: 'ready', providerConnections: [connection('claude')] }, { id: 'off', status: 'error' }] } as unknown as AppSnapshot['remoteConnections'],
    });
    expect(workspace.backends).toStrictEqual({ local: ['codex'], remote: ['claude'], down: [] });
    expect(projectCompanionWorkspace({ ...workspace, agents: [] }).backends).toStrictEqual(workspace.backends);
  });
});
