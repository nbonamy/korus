import { describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent } from '@workspace/core/contracts';
import type { DelegatedWorkReportPort } from '../../agents/delegated-work-report-service';
import { DelegatedWorkReportService } from '../../agents/delegated-work-report-service';
import type { AgentGitService } from '../agent-git-service';
import { AgentGitWorkflowService, parseAgentGitRequest } from '../agent-git-workflow-service';

function mergeReportFixture(provider: 'github' | 'gitlab' = 'github') {
  const snapshot = createInitialSnapshot();
  const source: Agent = { ...snapshot.agents[0]!, id: 'source', folder: '/repo-feature', status: { type: 'idle' },
    workspace: { kind: 'git', folder: '/repo-feature', repositoryName: 'repo', repositoryRoot: '/repo-feature',
      primaryWorktreeRoot: '/repo', branch: 'feature', isLinkedWorktree: true, updatedAt: '' } };
  snapshot.teams.push({ id: 'remote-team', name: 'Remote', agentIds: ['remote'], remoteConnectionId: 'ssh' });
  snapshot.agents = [source, { ...source, id: 'recipient', folder: '/repo' }, { ...source, id: 'moved' },
    { ...source, id: 'remote', teamId: 'remote-team' },
    { ...source, id: 'other-repo', workspace: { ...source.workspace!, primaryWorktreeRoot: '/other' } } as Agent];
  const sendPrompt = vi.fn();
  const sendMessage = vi.fn();
  const reports = new DelegatedWorkReportService({ getSnapshot: () => snapshot, sendPrompt, sendMessage,
    readConversationMessages: async () => [{ id: 'summary', agentId: source.id, turnId: 'report', role: 'assistant',
      status: 'complete', parts: [{ type: 'text', text: 'Implemented and tested.' }], createdAt: '' }],
  });
  const merge = vi.fn().mockResolvedValue({ targetFolder: '/repo' });
  const refreshWorkspaceIdentity = vi.fn(async (_id: string) => false);
  const service = new AgentGitWorkflowService({ applyEvent: vi.fn(), archiveConversation: vi.fn(), delegatedWorkReports: reports,
    driverRequest: vi.fn(), releaseConversation: vi.fn(), getSnapshot: () => snapshot,
    getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
    git: { merge, workflow: async () => ({ repository: provider === 'gitlab' ? 'gitlab.com/group/repo' : 'owner/repo', repositoryProvider: provider, branch: 'feature', files: [] }) } as unknown as AgentGitService,
    persistAndEmitSnapshot: vi.fn().mockResolvedValue(snapshot), refreshGitStatus: vi.fn(), refreshWorkspaceIdentity, sendPrompt: vi.fn(),
  });
  const request = (recipient: string) => ({ method: backendMethods.agentGitMerge, agentId: source.id,
    params: { input: { strategy: 'merge', deleteBranch: true, deleteWorktree: true, reportBack: true, reportBackAgentId: recipient, confirmed: true } } });
  return { snapshot, source, service, reports, request, sendPrompt, sendMessage, merge, refreshWorkspaceIdentity };
}

describe('AgentGitWorkflowService', () => {
  it('rejects a branch or head change during report preparation before pushing or creating a request', async () => {
    const snapshot = createInitialSnapshot(), agent = snapshot.agents[0]!; agent.folder = '/repo';
    let head = 'first';
    const workflow = vi.fn(async () => ({ repository: 'gitlab.com/group/repo', repositoryProvider: 'gitlab', folder: '/repo', branch: 'feature', detached: false, remote: 'origin', remoteUrl: 'git@gitlab.com:group/repo.git', headSha: head, ahead: 1 }));
    const push = vi.fn(), createPullRequest = vi.fn();
    const service = new AgentGitWorkflowService({ applyEvent: vi.fn(), archiveConversation: vi.fn(), driverRequest: vi.fn(), releaseConversation: vi.fn(), getSnapshot: () => snapshot,
      delegatedWorkReports: { prepare: async () => { head = 'second'; return null; } } as unknown as DelegatedWorkReportPort,
      getWorkIntegrations: () => ({ githubConnected: async () => false, repositoryConnected: async () => true, findPullRequest: async () => null, createPullRequest }),
      git: { workflow, assertPullRequestChanges: async () => {}, push } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(), refreshGitStatus: vi.fn(), refreshWorkspaceIdentity: vi.fn(), sendPrompt: vi.fn() });
    await expect(service.execute({ method: backendMethods.agentGitPullRequestCreate, agentId: agent.id, params: { input: { confirmed: true, title: 'Work', body: '', reportBack: true } } }, agent)).rejects.toThrow(/changed/i);
    expect(push).not.toHaveBeenCalled(); expect(createPullRequest).not.toHaveBeenCalled();
  });

  it.each(['github', 'gitlab'] as const)('captures native %s handoff before merge cleanup and reports to the selected repository peer', async provider => {
    const test = mergeReportFixture(provider);
    try {
      const merging = test.service.execute(test.request('recipient'), test.source);
      await vi.waitFor(() => expect(test.sendPrompt).toHaveBeenCalledOnce());
      expect(test.sendPrompt.mock.calls[0]?.[1]).toContain(provider === 'gitlab' ? 'without a merge request' : 'without a pull request');
      expect(test.merge).not.toHaveBeenCalled();
      test.reports.handleEvent({
        type: 'codex.conversationEventReceived', agentId: test.source.id, backend: 'codex',
        threadId: 'handoff', seq: 1, occurredAt: '', payload: { revision: 1, event: {
          type: 'turn.completed', seq: 1, occurredAt: '', origin: 'notification', conversationId: 'handoff', turnId: 'report',
          payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null },
        } },
      });
      await merging;
      expect(test.sendMessage).toHaveBeenCalledExactlyOnceWith(test.source.id, 'recipient', expect.stringContaining('Implemented and tested.'));
      expect(test.snapshot.agents.some(agent => agent.id === test.source.id)).toBe(false);
      expect(test.source.delegatedByAgentId).toBeUndefined();
    } finally { test.reports.close(); }
  });

  it.each(['source', 'missing', 'other-repo', 'remote', 'moved'])('rejects the invalid %s merge report recipient before handoff or Git mutation', async recipient => {
    const test = mergeReportFixture();
    if (recipient === 'moved') test.refreshWorkspaceIdentity.mockImplementation(async id => {
      if (id === 'moved') test.snapshot.agents.find(agent => agent.id === id)!.workspace = { kind: 'folder', folder: '/gone', label: 'Gone', updatedAt: '' };
      return true;
    });
    try {
      await expect(test.service.execute(test.request(recipient), test.source)).rejects.toThrow('same repository');
      expect(test.sendPrompt).not.toHaveBeenCalled();
      expect(test.merge).not.toHaveBeenCalled();
      expect(test.sendMessage).not.toHaveBeenCalled();
    } finally { test.reports.close(); }
  });

  it.each(['github', 'gitlab'] as const)('guards %s prune consent and ownership without treating request badges as merge proof', async provider => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.folder = '/repo';
    snapshot.agents = [agent];
    const target = { id: 'refs/remotes/origin/feature', revision: 'checked', name: 'origin/feature', branch: 'feature', kind: 'remote', sha: 'head', merged: false, blocked: 'notMerged', usedBy: [], changedFiles: 0 };
    const inventory = vi.fn(async () => ({ repository: 'repo', baseBranch: 'main', groups: [{ branch: 'feature', remotes: [target] }], unavailableRemotes: [] }));
    const prune = vi.fn(async (_folder, _input, owners) => {
      expect(owners()).toStrictEqual([{ folder: '/repo', name: agent.name }]);
      agent.folder = '/repo/new';
      expect(owners()).toStrictEqual([{ folder: '/repo/new', name: agent.name }]);
      return { deleted: [], failed: [] };
    });
    const pr = { number: 1, title: 'feature', url: 'https://github.com/owner/repo/pull/1', state: 'merged', headSha: 'head', draft: false };
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(), archiveConversation: vi.fn(), delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(), releaseConversation: vi.fn(), getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => provider === 'github', repositoryConnected: async () => true, findPullRequest: async () => pr }) as never,
      git: { pruning: { inventory, prune }, workflow: async () => ({ repository: provider === 'gitlab' ? 'gitlab.com/group/repo' : 'owner/repo', remote: 'origin' }) } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(), refreshGitStatus: vi.fn(), refreshWorkspaceIdentity: vi.fn(), sendPrompt: vi.fn(),
    });
    const result = await service.execute({ method: backendMethods.agentGitPruneGet, agentId: agent.id, params: {} }, agent);
    expect(result).toStrictEqual({ repository: 'repo', baseBranch: 'main', unavailableRemotes: [], groups: [{ branch: 'feature', remotes: [{ ...target, pullRequest: pr }] }] });
    await expect(service.execute({ method: backendMethods.agentGitPrune, agentId: agent.id, params: { input: { confirmed: false } } }, agent)).rejects.toThrow('requires explicit confirmation');
    expect(prune).not.toHaveBeenCalled();
    await service.execute({ method: backendMethods.agentGitPrune, agentId: agent.id, params: { input: { confirmed: true, targets: [{ id: target.id, revision: target.revision }] } } }, agent);
    expect(prune).toHaveBeenCalledTimes(1);
  });
  it('requires explicit revert consent and an unversioned-file choice before refreshing the affected agent', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    agent.folder = '/repo';
    const revert = vi.fn().mockResolvedValue(undefined);
    const workflow = vi.fn().mockResolvedValue({ folder: '/repo', files: [] });
    const refreshGitStatus = vi.fn();
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(), archiveConversation: vi.fn(),
      delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(), releaseConversation: vi.fn(),
      getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
      git: { revert, workflow } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(), refreshGitStatus,
      refreshWorkspaceIdentity: vi.fn(), sendPrompt: vi.fn(),
    });
    for (const input of [{ confirmed: false, includeUntracked: true }, { confirmed: true }, { confirmed: true, includeUntracked: 'true' }]) {
      await expect(service.execute({ method: backendMethods.agentGitRevert, agentId: agent.id, params: { input } }, agent)).rejects.toThrow();
    }
    expect(revert).not.toHaveBeenCalled();
    for (const includeUntracked of [true, false]) {
      await expect(service.execute({
        method: backendMethods.agentGitRevert, agentId: agent.id,
        params: { input: { confirmed: true, includeUntracked } },
      }, agent)).resolves.toStrictEqual({ folder: '/repo', files: [], githubConnected: false });
      expect(revert).toHaveBeenLastCalledWith('/repo', includeUntracked);
      expect(refreshGitStatus).toHaveBeenLastCalledWith(agent.id);
    }
  });

  it('recognizes only agent Git methods and preserves their params for routing', () => {
    const params = { agentId: 'agent-1', input: { paths: ['file.ts'], confirmed: true } };

    expect(parseAgentGitRequest(backendMethods.agentGitStage, params)).toStrictEqual({
      method: backendMethods.agentGitStage,
      agentId: 'agent-1',
      params,
    });
    expect(parseAgentGitRequest(backendMethods.clientNavigationSelectAgent, params)).toBeNull();
    expect(() => parseAgentGitRequest(backendMethods.agentGitStage, {})).toThrow('Invalid agentId.');
  });

  it('owns Git confirmation before invoking the low-level adapter', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    const stage = vi.fn();
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(),
      archiveConversation: vi.fn(),
      delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(),
      releaseConversation: vi.fn(),
      getSnapshot: () => snapshot,
      getWorkIntegrations: vi.fn(),
      git: { stage } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(),
      refreshGitStatus: vi.fn(),
      refreshWorkspaceIdentity: vi.fn(),
      sendPrompt: vi.fn(),
    });

    await expect(service.execute({
      method: backendMethods.agentGitStage,
      agentId: agent.id,
      params: { agentId: agent.id, input: { paths: ['file.ts'], confirmed: false } },
    }, agent)).rejects.toThrow('Staging files requires explicit confirmation.');
    expect(stage).not.toHaveBeenCalled();
  });

  it('returns provider turn diffs without emitting presentation events or rebuilding repository state', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    snapshot.turnGitDiffs['turn-1'] = {
      agentId: agent.id,
      turnId: 'turn-1',
      addedLines: 2,
      removedLines: 1,
      diff: 'turn diff',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const applyEvent = vi.fn();
    const diff = vi.fn();
    const service = new AgentGitWorkflowService({
      applyEvent,
      archiveConversation: vi.fn(),
      delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(),
      releaseConversation: vi.fn(),
      getSnapshot: () => snapshot,
      getWorkIntegrations: vi.fn(),
      git: { diff } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(),
      refreshGitStatus: vi.fn(),
      refreshWorkspaceIdentity: vi.fn(),
      sendPrompt: vi.fn(),
    });

    const result = await service.execute({
      method: backendMethods.agentGitDiffGet,
      agentId: agent.id,
      params: { target: { type: 'turn', turnId: 'turn-1' } },
    }, agent);

    expect(diff).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      target: { type: 'turn', turnId: 'turn-1' }, diff: 'turn diff',
      summary: { addedLines: 2, removedLines: 1, changedFiles: 0 }, sections: [],
    });
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it('archives the provider session before closing an agent after a merged-branch push', async () => {
    const snapshot = createInitialSnapshot();
    const agent: Agent = {
      id: 'agent-1', name: 'Agent', folder: '/repo', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-1' }, status: { type: 'idle' },
      createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    snapshot.agents = [agent];
    snapshot.teams[0]!.agentIds = [agent.id];
    const archiveConversation = vi.fn().mockResolvedValue(undefined);
    const persistAndEmitSnapshot = vi.fn().mockResolvedValue(snapshot);
    const push = vi.fn().mockResolvedValue(undefined);
    const workflow = vi.fn().mockResolvedValue({
      branch: 'main', detached: false, remote: 'origin', upstream: 'origin/main',
      remoteUrl: 'git@github.com:owner/repo.git', repository: 'owner/repo', ahead: 0, behind: 0, files: [],
    });
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(),
      archiveConversation,
      delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(),
      releaseConversation: vi.fn(),
      getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
      git: { push, workflow } as unknown as AgentGitService,
      persistAndEmitSnapshot,
      refreshGitStatus: vi.fn(),
      refreshWorkspaceIdentity: vi.fn(),
      sendPrompt: vi.fn(),
    });

    await service.execute({
      method: backendMethods.agentGitPush,
      agentId: agent.id,
      params: { input: { confirmed: true, target: 'mergeTarget', closeAgentAfterPush: true } },
    }, agent);

    expect(archiveConversation).toHaveBeenCalledWith(agent);
    expect(snapshot.agents).toStrictEqual([]);
    expect(persistAndEmitSnapshot).toHaveBeenCalledOnce();
  });

  it.each([
    { type: 'worktreeFolderRetained', folder: '/repo-feature' },
    { type: 'branchRetained', branch: 'feature' },
  ])('closes the merged agent while returning a non-blocking $type warning', async (warning) => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    agent.folder = '/repo-feature';
    const releaseConversation = vi.fn().mockResolvedValue(undefined);
    const archiveConversation = vi.fn().mockResolvedValue(undefined);
    const persistAndEmitSnapshot = vi.fn().mockResolvedValue(snapshot);
    const merge = vi.fn().mockResolvedValue({
      targetFolder: '/repo',
      warning,
    });
    const workflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo', folder: '/repo', isLinkedWorktree: false,
      branch: 'main', detached: false, ahead: 1, behind: 0,
      files: [], stagedFiles: [], unstagedFiles: [], githubConnected: false,
    });
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(), archiveConversation, delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(), releaseConversation, getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
      git: { merge, workflow } as unknown as AgentGitService,
      persistAndEmitSnapshot, refreshGitStatus: vi.fn(), refreshWorkspaceIdentity: vi.fn(), sendPrompt: vi.fn(),
    });

    await expect(service.execute({
      method: backendMethods.agentGitMerge,
      agentId: agent.id,
      params: { input: { strategy: 'merge', deleteBranch: true, deleteWorktree: true, confirmed: true } },
    }, agent)).resolves.toMatchObject({
      warning,
    });

    expect(releaseConversation).toHaveBeenCalledWith(agent);
    expect(archiveConversation).toHaveBeenCalledWith(agent);
    expect(snapshot.agents.some((candidate) => candidate.id === agent.id)).toBe(false);
    expect(persistAndEmitSnapshot).toHaveBeenCalledOnce();
  });

  it.each(['base', 'pull'] as const)('hands %s merge conflicts to the affected agent with branch context', async (source) => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    agent.folder = '/repo-feature';
    const updateFromBase = vi.fn().mockResolvedValue({
      baseBranch: 'main',
      branch: 'feature/demo',
      conflicts: ['src/app.ts', 'src/state.ts'],
    });
    const pull = vi.fn().mockResolvedValue({ upstream: 'origin/feature/demo', branch: 'feature/demo', conflicts: ['src/app.ts', 'src/state.ts'] });
    const workflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo', folder: '/repo-feature', isLinkedWorktree: true,
      baseBranch: 'main', branch: 'feature/demo', detached: false, ahead: 0, behind: 0,
      files: [], stagedFiles: [], unstagedFiles: [],
    });
    const sendPrompt = vi.fn();
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(),
      archiveConversation: vi.fn(),
      delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(),
      releaseConversation: vi.fn(),
      getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
      git: { updateFromBase, pull, workflow } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(),
      refreshGitStatus: vi.fn(),
      refreshWorkspaceIdentity: vi.fn(),
      sendPrompt,
    });

    await expect(service.execute({
      method: source === 'pull' ? backendMethods.agentGitPull : backendMethods.agentGitUpdateFromBase,
      agentId: agent.id,
      params: { input: { confirmed: true, allowDirty: true } },
    }, agent)).resolves.toMatchObject({
      ...(source === 'pull' ? { upstream: 'origin/feature/demo' } : { baseBranch: 'main' }),
      branch: 'feature/demo',
      conflicts: ['src/app.ts', 'src/state.ts'],
      workflow: { branch: 'feature/demo' },
    });

    expect(source === 'pull' ? pull : updateFromBase).toHaveBeenCalledWith('/repo-feature', true);
    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(agent.id, expect.stringContaining(
      `Git encountered conflicts while updating \`feature/demo\` from \`${source === 'pull' ? 'origin/feature/demo' : 'main'}\``,
    ));
    expect(sendPrompt.mock.calls[0]![1]).toMatch(/src\/app\.ts[\s\S]*resolve the conflicts/i);
  });

  it.each(['base', 'pull'] as const)('does not prompt the agent after a clean %s update', async (source) => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0] as Agent;
    const updateFromBase = vi.fn().mockResolvedValue({ baseBranch: 'main', branch: 'feature/demo', conflicts: [] });
    const pull = vi.fn().mockResolvedValue({ upstream: 'origin/feature/demo', branch: 'feature/demo', conflicts: [] });
    const workflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo', folder: '/repo-feature', isLinkedWorktree: true,
      baseBranch: 'main', branch: 'feature/demo', detached: false, ahead: 0, behind: 0,
      files: [], stagedFiles: [], unstagedFiles: [],
    });
    const sendPrompt = vi.fn();
    const service = new AgentGitWorkflowService({
      applyEvent: vi.fn(), archiveConversation: vi.fn(), delegatedWorkReports: {} as DelegatedWorkReportPort,
      driverRequest: vi.fn(), releaseConversation: vi.fn(), getSnapshot: () => snapshot,
      getWorkIntegrations: () => ({ githubConnected: async () => false }) as never,
      git: { updateFromBase, pull, workflow } as unknown as AgentGitService,
      persistAndEmitSnapshot: vi.fn(), refreshGitStatus: vi.fn(), refreshWorkspaceIdentity: vi.fn(), sendPrompt,
    });

    await service.execute({
      method: source === 'pull' ? backendMethods.agentGitPull : backendMethods.agentGitUpdateFromBase,
      agentId: agent.id,
      params: { input: { confirmed: true } },
    }, agent);

    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
