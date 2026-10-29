import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import AppShell from '../components/AppShell.vue';
import AgentCloseDialog from '../components/AgentCloseDialog.vue';
import PullRequestCleanupDialog from '../components/PullRequestCleanupDialog.vue';
import SessionCompressionDialog from '../components/SessionCompressionDialog.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { setElectronTestClient } from '../test/client';
import { ElMessage } from 'element-plus';
import type { AppSnapshot } from '@workspace/core/contracts';
import { deferred } from './app-state-test-harness';
import { createClientApiMock } from '../test/client-api-mock';

afterEach(() => {
  delete window.app;
});

describe('App', () => {
  it.each(['success', 'error'])('backgrounds worktree deletion and reports %s without disturbing a later close dialog', async outcome => {
    // The operation must outlive its dialog, retain its original agent, reject
    // duplicate submissions, and never clear or overwrite a later dialog.
    const snapshot = createInitialSnapshot();
    const [first, second] = snapshot.agents;
    first!.name = null;
    first!.workspace = { kind: 'git', folder: '/repo-fix-api', repositoryRoot: '/repo', primaryWorktreeRoot: '/repo', repositoryName: 'repo', branch: 'fix/api', isLinkedWorktree: true, updatedAt: first!.updatedAt };
    const pending = deferred<AppSnapshot>();
    const closeAgent = vi.fn(() => pending.promise);
    const getAgentClosePreview = vi.fn(async () => ({ isLinkedWorktree: true, branch: 'fix/api', upstream: null, hasChanges: false }));
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never);
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never);
    setElectronTestClient({ getSnapshot: async () => snapshot, getAgentClosePreview, closeAgent, onEvent: vi.fn(),
      selectAgent: async agentId => ({ ...snapshot, activeAgentId: agentId }) });
    const wrapper = mount(App, { global: { stubs: { AppShell: true } } });
    await flushPromises();
    const shell = wrapper.getComponent(AppShell);
    shell.vm.$emit('close-agent', first!.id);
    await flushPromises();
    const dialog = wrapper.getComponent(AgentCloseDialog);
    expect(dialog.get('h2').text()).toBe('Close fix/api?');
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(dialog.get('[role="status"]').attributes('aria-busy')).toBe('true');
    expect(dialog.find('h2').exists()).toBe(false);
    const background = dialog.findAll('button').find(button => button.text() === 'Run in background');
    expect(background).toBeDefined();
    await background!.trigger('click');
    expect(dialog.props('visible')).toBe(false);
    shell.vm.$emit('close-agent', first!.id);
    await flushPromises();
    expect(getAgentClosePreview).toHaveBeenCalledTimes(1);
    expect(closeAgent).toHaveBeenCalledExactlyOnceWith(first!.id, { deleteWorktree: true, deleteRemoteBranch: false, discardChanges: false, confirmed: true });
    shell.vm.$emit('close-agent', second!.id);
    await flushPromises();
    expect(dialog.props('agent')?.id).toBe(second!.id);
    expect(dialog.props('visible')).toBe(true);
    shell.vm.$emit('select-agent', second!.id);
    await flushPromises();
    const fallback = { ...second!, id: 'fallback-agent', name: 'Fallback' };
    if (outcome === 'success') pending.resolve({ ...snapshot, agents: [second!, fallback], activeAgentId: fallback.id });
    else pending.reject(new Error('Worktree is locked'));
    await flushPromises();
    expect(dialog.props('agent')?.id).toBe(second!.id);
    expect(dialog.props('visible')).toBe(true);
    expect(dialog.props('busy')).toBe(false);
    expect(dialog.find('[role="alert"]').exists()).toBe(false);
    expect(shell.props('activeAgent')?.id).toBe(second!.id);
    if (outcome === 'success') expect(success).toHaveBeenCalledWith('Worktree deleted: fix/api');
    else expect(error).toHaveBeenCalledWith('Worktree deletion failed: Worktree is locked');
    success.mockRestore(); error.mockRestore();
  });

  it('keeps deletion consent after a foreground failure and retries only on explicit submission', async () => {
    const snapshot = createInitialSnapshot();
    const pending = deferred<AppSnapshot>();
    const closeAgent = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ ...snapshot, agents: [] });
    setElectronTestClient({ getSnapshot: async () => snapshot, closeAgent, onEvent: vi.fn(),
      getAgentClosePreview: async () => ({ isLinkedWorktree: true, branch: 'fix/api', upstream: 'origin/fix/api', hasChanges: true }) });
    const wrapper = mount(App, { global: { stubs: { AppShell: true } } });
    await flushPromises();
    wrapper.getComponent(AppShell).vm.$emit('close-agent', snapshot.agents[0]!.id);
    await flushPromises();
    const dialog = wrapper.getComponent(AgentCloseDialog);
    expect(dialog.get('.agent-close-dialog__remote input').element).toHaveProperty('checked', false);
    await dialog.get('.agent-close-dialog__discard input').setValue(true);
    await dialog.get('.agent-close-dialog__remote input').setValue(true);
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(dialog.get('[role="status"]').attributes('aria-busy')).toBe('true');
    pending.reject(new Error('Cleanup failed'));
    await flushPromises();
    expect(dialog.get('[role="alert"]').text()).toBe('Cleanup failed');
    expect(closeAgent).toHaveBeenCalledTimes(1);
    expect(dialog.get('.agent-close-dialog__discard input').element).toHaveProperty('checked', true);
    expect(dialog.get('.agent-close-dialog__remote input').element).toHaveProperty('checked', true);
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(closeAgent).toHaveBeenLastCalledWith(snapshot.agents[0]!.id, { deleteWorktree: true, deleteRemoteBranch: true, discardChanges: true, confirmed: true });
    expect(dialog.props('visible')).toBe(false);
  });

  it('opens a plan review from a backend domain event without a panel request', async () => {
    const snapshot = createInitialSnapshot();
    const { api, emit } = createClientApiMock(snapshot);
    setElectronTestClient(api);
    const wrapper = mount(App);
    await flushPromises();

    emit({
      seq: 1, occurredAt: '2026-09-16T00:00:00.000Z',
      agentId: snapshot.activeAgentId!, turnId: 'turn-plan',
      type: 'plan.readyForReview',
      payload: { itemId: 'proposal-1', markdown: '# Domain review\n\nBuild the unified backend.' },
    });
    await flushPromises();

    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Domain review');
    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Build the unified backend.');
    expect(wrapper.get('.plan-review-footer').findAll('button').map(button => button.text())).toContain('Approve');
  });

  it('loads the main-process snapshot on mount', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.backendRuntimes = [{
      backend: 'codex',
      status: 'running',
      detail: 'ready',
    }];

    const getSnapshot = vi.fn().mockResolvedValue(snapshot);
    setElectronTestClient({
      getSnapshot,
      onEvent: vi.fn(),
    });

    const wrapper = mount(App, {
      global: {
        stubs: {
          ElPopover: {
            template: '<div><slot name="reference" /><slot /></div>',
          },
        },
      },
    });

    await flushPromises();

    expect(getSnapshot).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Ready to get going');
    expect(wrapper.text()).toContain('Chat with Dina');
  });

  it('gives the conversation pane a promise-returning prompt action', async () => {
    const snapshot = createInitialSnapshot();
    const sendPrompt = vi.fn().mockResolvedValue(snapshot);
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      onEvent: vi.fn(),
      sendPrompt,
    });
    const wrapper = mount(App, {
      global: { stubs: { AppShell: true } },
    });
    await flushPromises();

    const action = wrapper.findComponent(AppShell).props('sendPromptAction') as (
      prompt: string,
    ) => Promise<void>;
    await action('hello');

    expect(sendPrompt).toHaveBeenCalledWith(snapshot.activeAgentId, 'hello');
  });

  it('submits bare compact without opening the session-compression flow', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0].backendSession = { kind: 'codex', threadId: 'thread-old' };
    const sendPrompt = vi.fn().mockResolvedValue(snapshot);
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      onEvent: vi.fn(),
      sendPrompt,
    });
    const wrapper = mount(App, {
      global: { stubs: { AppShell: true } },
    });
    await flushPromises();

    const action = wrapper.findComponent(AppShell).props('sendPromptAction') as (
      prompt: string,
    ) => Promise<void>;
    await action('/compact');

    expect(sendPrompt).toHaveBeenCalledWith(snapshot.activeAgentId, '/compact');
    const dialog = wrapper.findComponent(SessionCompressionDialog);
    expect(dialog.props('visible')).toBe(false);
  });

  it('blocks the whole app while resource sharing restarts the backend', async () => {
    const snapshot = createInitialSnapshot();
    let resolveSharing!: (value: typeof snapshot) => void;
    const setCodexResourceSharing = vi.fn().mockReturnValue(new Promise<typeof snapshot>((resolve) => {
      resolveSharing = resolve;
    }));
    const reloadRenderer = vi.fn().mockRejectedValue(new Error('renderer replaced'));
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      onEvent: vi.fn(),
      setCodexResourceSharing,
      reloadRenderer,
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppShell: true,
          ElPopover: {
            template: '<div><slot name="reference" /><slot /></div>',
          },
        },
      },
    });
    await flushPromises();

    const appShell = wrapper.findComponent(AppShell);
    const operation = (appShell.props() as {
      setCodexResourceSharing(input: { enabled: true }): Promise<void>;
    }).setCodexResourceSharing({ enabled: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="backend-restart-overlay"]').text()).toContain('Restarting the backend and reconnecting your chats.');
    expect(wrapper.getComponent(AppShell).attributes('inert')).toBe('');
    expect(wrapper.getComponent(AppShell).attributes('aria-hidden')).toBe('true');

    resolveSharing(snapshot);
    await operation;
    await flushPromises();

    expect(reloadRenderer).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="backend-restart-overlay"]').exists()).toBe(false);
  });

  it('tracks desktop update status, installs updates, and releases subscriptions', async () => {
    const snapshot = createInitialSnapshot();
    let statusListener: ((status: { state: 'available'; version: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    const installUpdate = vi.fn().mockResolvedValue(undefined);
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      onEvent: vi.fn(),
      getUpdateStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      onUpdateStatusChanged: vi.fn((listener) => {
        statusListener = listener as typeof statusListener;
        return unsubscribe;
      }),
      installUpdate,
    });
    const wrapper = mount(App, {
      global: { stubs: { AppShell: true } },
    });
    await flushPromises();

    statusListener?.({ state: 'available', version: '0.7.0' });
    await wrapper.vm.$nextTick();
    const appShell = wrapper.findComponent(AppShell);
    appShell.vm.$emit('install-update');
    await flushPromises();
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(installUpdate).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('closes an agent without offering cleanup when another agent uses the same worktree', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const otherAgent = {
      ...agent,
      id: 'agent-shared-worktree',
      name: 'Shared worktree agent',
    };
    snapshot.agents = [agent, otherAgent];
    snapshot.teams[0]!.agentIds = [agent.id, otherAgent.id];
    const getAgentClosePreview = vi.fn().mockResolvedValue({ isLinkedWorktree: false, branch: null, upstream: null, hasChanges: false });
    const closeAgent = vi.fn().mockResolvedValue({
      ...snapshot,
      agents: snapshot.agents.filter((candidate) => candidate.id !== agent.id),
    });
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      getAgentClosePreview,
      closeAgent,
      onEvent: vi.fn(),
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppShell: true,
          ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
        },
      },
    });
    await flushPromises();

    wrapper.findComponent(AppShell).vm.$emit('close-agent', agent.id);
    await flushPromises();

    expect(wrapper.findComponent(AgentCloseDialog).props('visible')).toBe(false);
    expect(closeAgent).toHaveBeenCalledWith(agent.id);
    expect(getAgentClosePreview).toHaveBeenCalledWith(agent.id);
  });

  it('does not treat matching folder paths on different backend locations as a shared worktree', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const remoteAgent = {
      ...agent,
      id: 'agent-remote-same-path',
      teamId: 'team-remote',
      remoteConnectionId: 'connection-devbox',
      name: 'Remote agent',
    };
    snapshot.agents = [agent, remoteAgent];
    snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.teams.push({
      id: 'team-remote',
      name: 'Remote',
      avatar: 'RE',
      color: snapshot.teams[0]!.color,
      agentIds: [remoteAgent.id],
    });
    const getAgentClosePreview = vi.fn().mockResolvedValue({
      repository: 'owner/repo',
      folder: agent.folder,
      isLinkedWorktree: true,
      hasChanges: false,
      branch: 'fix/local-worktree',
      detached: false,
      remote: 'origin',
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      githubConnected: true,
    });
    const closeAgent = vi.fn();
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      getAgentClosePreview,
      closeAgent,
      onEvent: vi.fn(),
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppShell: true,
          ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
        },
      },
    });
    await flushPromises();

    wrapper.findComponent(AppShell).vm.$emit('close-agent', agent.id);
    await flushPromises();

    expect(getAgentClosePreview).toHaveBeenCalledWith(agent.id);
    expect(wrapper.findComponent(AgentCloseDialog).props('visible')).toBe(true);
    expect(closeAgent).not.toHaveBeenCalled();
  });

  it('cleans up a tracked closed pull request from the sidebar alert', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.pullRequest = {
      provider: 'github',
      repository: 'nbonamy/agent-workspace',
      branch: 'feat/merged',
      number: 7,
      title: 'Merged work',
      url: 'https://github.com/nbonamy/agent-workspace/pull/7',
      draft: false,
      headSha: 'abc123',
      state: 'closed',
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    };
    const closeAgent = vi.fn().mockResolvedValue({ ...snapshot, agents: [] });
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      closeAgent,
      onEvent: vi.fn(),
    });
    const wrapper = mount(App, {
      global: {
        stubs: {
          AppShell: true,
          ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
        },
      },
    });
    await flushPromises();

    wrapper.findComponent(AppShell).vm.$emit('cleanup-pull-request', snapshot.agents[0]!.id);
    await wrapper.vm.$nextTick();
    const dialog = wrapper.findComponent(PullRequestCleanupDialog);
    expect(dialog.props('visible')).toBe(true);

    dialog.vm.$emit('confirm');
    await flushPromises();

    expect(closeAgent).toHaveBeenCalledWith(snapshot.agents[0]!.id, {
      deleteWorktree: true,
      pullRequestCleanup: true,
      confirmed: true,
    });
    expect(dialog.props('visible')).toBe(false);
  });

});
