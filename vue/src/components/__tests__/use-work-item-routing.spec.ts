import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { Agent, AppSnapshot, SourceRepository, WorkItem } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import { describe, expect, it, vi } from 'vitest';
import { useWorkItemRouting } from '../use-work-item-routing';

describe('useWorkItemRouting', () => {
  it('honors an explicit model when launching from a repository backlog', async () => {
    const harness = createHarness();
    await harness.routing.startRepositoryWork(harness.agent.id, {
      item: harness.item, action: 'fix', target: 'duplicate', backend: 'claude', model: 'sonnet', reasoningEffort: 'high',
      workspace: { kind: 'worktree', branchName: 'fix/gh-12' },
    });
    expect(harness.createAgent).toHaveBeenCalledWith(expect.objectContaining({ modelSelection: { model: 'sonnet', reasoningEffort: 'high' } }));
  });
  it.each([1, 2])('shows provisioning until all %i work items are handed over with their selected model', async count => {
    const harness = createHarness();
    let prepared!: () => void;
    harness.createWorktree.mockImplementation(() => new Promise(resolve => { prepared = () => resolve({ name: 'work', path: '/code/work' }); }));
    // One held worktree is enough to prove the operation remains running during provisioning.
    if (count === 2) harness.createWorktree.mockResolvedValueOnce({ name: 'first', path: '/code/first' });
    const running = harness.routing.startMany({ action: 'fix', items: Array.from({ length: count }, (_, i) => ({ ...harness.item, id: `issue-${i}`, number: i + 1 })), teamId: harness.teamId, backend: 'claude', model: 'sonnet', reasoningEffort: 'high' });
    await vi.waitFor(() => expect(harness.createWorktree).toHaveBeenCalledTimes(count));
    expect(harness.routing.creationProgress.value).toMatchObject({ mode: count === 1 ? 'single' : 'multiple' });
    prepared();
    await running;
    expect(harness.createAgent).toHaveBeenCalledWith(expect.objectContaining({ backend: 'claude', modelSelection: { model: 'sonnet', reasoningEffort: 'high' } }));
    const progress = harness.routing.creationProgress.value!;
    expect(progress.mode === 'single' ? progress.progress.state : progress.state).toBe('success');
    expect(harness.assign).toHaveBeenCalledTimes(count);
  });

  it('keeps provisioning failures visible without starting a prompt', async () => {
    const harness = createHarness();
    harness.createWorktree.mockRejectedValueOnce(new Error('Worktree preparation failed'));
    await expect(harness.routing.startMany({ action: 'fix', items: [harness.item], teamId: harness.teamId })).rejects.toThrow('Worktree preparation failed');
    expect(harness.routing.creationProgress.value).toMatchObject({ mode: 'single', progress: { state: 'error', error: 'Worktree preparation failed' } });
    expect(harness.assign).not.toHaveBeenCalled();
  });
  it('does not start an agent after preparation fails, reassignment is cancelled, or selection changes', async () => {
    const listedItem = item({ provider: 'linear', id: 'linear:uuid', identifier: 'ENG-12' });
    const repository = { name: 'agent-workspace', path: '/code/app', worktrees: [] };
    const cancelled = createHarness({ item: listedItem, assignedToCurrentAgent: true, confirmReassignment: false });
    await expect(cancelled.routing.createIsolatedAgent(listedItem, cancelled.teamId, { repository })).rejects.toThrow();
    expect(cancelled.createWorktree).not.toHaveBeenCalled();
    const failed = createHarness();
    failed.createWorktree.mockRejectedValueOnce(new Error('Repository unavailable'));
    await expect(failed.routing.createIsolatedAgent(listedItem, failed.teamId, { repository })).rejects.toThrow('Repository unavailable');
    expect(failed.createAgent).not.toHaveBeenCalled();
    let current = true;
    failed.createWorktree.mockImplementationOnce(async () => { current = false; return { name: 'work', path: '/code/work' }; });
    await expect(failed.routing.createIsolatedAgent(listedItem, failed.teamId, { repository, isCurrent: () => current })).rejects.toThrow('selection changed');
    expect(failed.createAgent).not.toHaveBeenCalled();
    expect(failed.assign).not.toHaveBeenCalled();
  });
  it('stops branch preparation if the Linear selection changes while duplicating an agent', async () => {
    const harness = createHarness();
    harness.agent.workspace = { kind: 'git', folder: '/code', repositoryName: 'code', repositoryRoot: '/code', primaryWorktreeRoot: '/code', branch: 'main', isLinkedWorktree: false, updatedAt: '' };
    let current = true;
    harness.duplicateAgent.mockImplementationOnce(async () => { current = false; return harness.createdAgent; });
    await expect(harness.routing.startRepositoryWork(harness.agent.id, {
      item: item({ provider: 'linear', id: 'linear:uuid', identifier: 'ENG-12' }), action: 'fix', target: 'duplicate',
      workspace: { kind: 'worktree', branchName: 'fix/eng-12' }, isCurrent: () => current,
    })).rejects.toThrow('selection changed');
    expect(harness.createBranch).not.toHaveBeenCalled();
    expect(harness.assign).not.toHaveBeenCalled();
  });
  it('starts Linear work in the explicit repository on the selected host and preserves full issue identity', async () => {
    const listedItem = item({ provider: 'linear', id: 'linear:eng-uuid', identifier: 'ENG-12', sourceName: 'Engineering', sourceId: 'linear:team' });
    const harness = createHarness({ item: listedItem, remoteConnectionId: 'remote-dev' });
    await harness.routing.startMany({ action: 'fix', items: [listedItem], teamId: harness.teamId, repository: { name: 'agent-workspace', path: '/workspace/agent-workspace', worktrees: [] } });
    expect(harness.createWorktree).toHaveBeenCalledWith({ repoPath: '/workspace/agent-workspace', branchName: 'fix/eng-12', remoteConnectionId: 'remote-dev' });
    expect(harness.assign).toHaveBeenCalledWith({ agentId: harness.createdAgent.id, item: listedItem, prompt: expect.stringContaining('Issue: ENG-12') });
    await expect(harness.routing.createIsolatedAgent(listedItem, harness.teamId)).rejects.toThrow();
    expect(harness.createAgent).toHaveBeenCalledOnce();
  });
  it('assigns prompted work to an existing session without touching its branch', async () => {
    const harness = createHarness();

    await harness.routing.startInExistingSession(harness.agent.id, harness.item, 'fix');

    expect(harness.createBranch).not.toHaveBeenCalled();
    expect(harness.assign).toHaveBeenCalledWith(expect.objectContaining({
      agentId: harness.agent.id,
      item: harness.item,
      prompt: expect.stringContaining('Fix this GitHub issue'),
    }));
  });

  it('resolves a pull-request branch and creates an isolated agent in the team environment', async () => {
    const listedItem = item({ kind: 'pullRequest', branchName: undefined });
    const resolvedItem = { ...listedItem, branchName: 'feature/fix-routing' };
    const harness = createHarness({ item: listedItem, loadItemsResult: [resolvedItem], remoteConnectionId: 'remote-dev' });

    const result = await harness.routing.createIsolatedAgent(listedItem, harness.teamId);

    expect(harness.loadItems).toHaveBeenCalledWith('github', listedItem.sourceId, {
      kind: 'pullRequest',
      state: 'all',
    });
    expect(harness.createWorktree).toHaveBeenCalledWith({
      repoPath: '/workspace/agent-workspace',
      branchName: 'feature/fix-routing',
      remoteConnectionId: 'remote-dev',
    });
    expect(harness.createAgent).toHaveBeenCalledWith({
      name: null,
      folder: '/workspace/agent-workspace-feature',
      sourceRepositoryName: 'agent-workspace',
      teamId: harness.teamId,
    });
    expect(result).toStrictEqual({ agent: harness.createdAgent, item: resolvedItem });
  });

  it('passes an explicit existing-worktree decision to creation', async () => {
    const harness = createHarness();

    await harness.routing.createIsolatedAgent(harness.item, harness.teamId, { reuseExisting: true });

    expect(harness.createWorktree).toHaveBeenCalledWith({
      repoPath: '/workspace/agent-workspace',
      branchName: 'fix/gh-12',
      reuseExisting: true,
    });
  });

  it('creates the isolated agent with the chosen model layered over provider defaults', async () => {
    const harness = createHarness();

    await harness.routing.createIsolatedAgent(harness.item, harness.teamId, { backend: 'codex', model: 'gpt-fast', reasoningEffort: 'high' });

    expect(harness.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'codex',
      modelSelection: { model: 'gpt-fast', reasoningEffort: 'high' },
    }));
  });

  it('keeps a reassigned item out of the new-agent flow when the warning is declined', async () => {
    const harness = createHarness({ assignedToCurrentAgent: true, confirmReassignment: false });

    await harness.routing.openNewAgent({ item: harness.item });

    expect(harness.confirmReassignment).toHaveBeenCalledWith(expect.stringContaining(
      `already assigned to ${harness.agent.name}`,
    ));
    expect(harness.openNewAgent).not.toHaveBeenCalled();
    expect(harness.routing.newAgentItem.value).toBeNull();
  });

  it('prefills the active agent composer and returns focus to it', () => {
    const harness = createHarness({ composerText: 'Please handle this carefully.' });

    harness.routing.prefill(harness.agent.id, harness.item);

    expect(harness.updateComposer).toHaveBeenCalledWith(
      harness.agent.id,
      expect.stringMatching(/^Please handle this carefully\.\n\n/),
    );
    expect(harness.selectAgent).toHaveBeenCalledWith(harness.agent.id);
    expect(harness.focusComposer).toHaveBeenCalledOnce();
  });
});

function createHarness(input: {
  assignedToCurrentAgent?: boolean;
  composerText?: string;
  confirmReassignment?: boolean;
  item?: WorkItem;
  loadItemsResult?: WorkItem[];
  remoteConnectionId?: string;
} = {}) {
  const snapshot = createInitialSnapshot();
  const team = snapshot.teams[0]!;
  const agent = snapshot.agents[0]!;
  agent.workspace = { kind: 'git', folder: '/workspace/agent-workspace', repositoryName: 'agent-workspace', repositoryRoot: '/workspace/agent-workspace', primaryWorktreeRoot: '/workspace/agent-workspace', branch: 'main', isLinkedWorktree: false, updatedAt: 'now' };
  const listedItem = input.item ?? item();
  if (input.remoteConnectionId) team.remoteConnectionId = input.remoteConnectionId;
  if (input.assignedToCurrentAgent) {
    snapshot.workBacklog.assignments[workItemAssignmentKey(listedItem)] = {
      provider: listedItem.provider,
      itemId: listedItem.id,
      agentId: agent.id,
      assignedAt: '2026-09-02T12:00:00.000Z',
      policy: 'review',
      status: 'inProgress',
    };
  }

  const createdAgent: Agent = {
    ...agent,
    id: 'agent-created',
    folder: '/workspace/agent-workspace-feature',
  };
  const sourceRepositories: SourceRepository[] = [{
    name: 'agent-workspace',
    path: '/workspace/agent-workspace',
    worktrees: [],
  }];
  const assign = vi.fn(async () => undefined);
  const assignFromUi = vi.fn();
  const createAgent = vi.fn(async () => createdAgent);
  const createBranch = vi.fn(async () => undefined);
  const createWorktree = vi.fn(async () => ({
    name: 'feature/fix-routing',
    path: '/workspace/agent-workspace-feature',
  }));
  const duplicateAgent = vi.fn(async () => createdAgent);
  const loadItems = vi.fn(async () => input.loadItemsResult);
  const confirmReassignment = vi.fn(async () => input.confirmReassignment ?? true);
  const focusComposer = vi.fn();
  const openNewAgent = vi.fn();
  const selectAgent = vi.fn();
  const updateComposer = vi.fn();

  const routing = useWorkItemRouting({
    actions: {
      assign,
      assignFromUi,
      createAgent,
      createBranch,
      createWorktree,
      listBranches: vi.fn().mockResolvedValue([]),
      duplicateAgent,
      loadItems,
    },
    model: {
      activeTeamId: () => team.id,
      composerText: () => input.composerText ?? '',
      currentAgent: () => agent,
      snapshot: () => snapshot as AppSnapshot,
      sourceRepositories: () => sourceRepositories,
    },
    ui: {
      confirmReassignment,
      focusComposer,
      openNewAgent,
      selectAgent,
      updateComposer,
    },
  });

  return {
    agent,
    assign,
    assignFromUi,
    confirmReassignment,
    createAgent,
    createBranch,
    createdAgent,
    createWorktree,
    focusComposer,
    duplicateAgent,
    item: listedItem,
    loadItems,
    openNewAgent,
    routing,
    selectAgent,
    teamId: team.id,
    updateComposer,
  };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace#12',
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number: 12,
    title: 'Fix cockpit drag target',
    url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    state: 'open',
    labels: [],
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T11:00:00.000Z',
    ...overrides,
  };
}
