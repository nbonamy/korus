import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import AppShell from '../components/AppShell.vue';
import AgentCloseDialog from '../components/AgentCloseDialog.vue';
import PullRequestCleanupDialog from '../components/PullRequestCleanupDialog.vue';
import SessionCompressionDialog from '../components/SessionCompressionDialog.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { setElectronTestClient } from '../test/client';

afterEach(() => {
  delete window.app;
});

describe('App', () => {
  it('opens a plan review from a backend domain event without a panel request', async () => {
    const snapshot = createInitialSnapshot();
    let emitEvent!: (event: import('@workspace/core/contracts').MainToRendererEvent) => void;
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      onEvent: (listener) => { emitEvent = listener; return () => undefined; },
    });
    const wrapper = mount(App);
    await flushPromises();

    emitEvent({
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

  it('prompts for linked-worktree cleanup and forwards the confirmed cleanup policy', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [snapshot.agents[0]!];
    snapshot.teams[0]!.agentIds = [snapshot.agents[0]!.id];
    const getAgentGitWorkflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo',
      folder: snapshot.agents[0]!.folder,
      isLinkedWorktree: true,
      branch: 'fix/gh-22',
      detached: false,
      remote: 'origin',
      upstream: 'origin/fix/gh-22',
      ahead: 0,
      behind: 0,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      githubConnected: true,
    });
    const closeAgent = vi.fn().mockResolvedValue({ ...snapshot, agents: [] });
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      getAgentGitWorkflow,
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

    wrapper.findComponent(AppShell).vm.$emit('close-agent', snapshot.agents[0]!.id);
    await flushPromises();

    expect(getAgentGitWorkflow).toHaveBeenCalledWith(snapshot.agents[0]!.id);
    const dialog = wrapper.findComponent(AgentCloseDialog);
    expect(dialog.props('visible')).toBe(true);

    dialog.vm.$emit('delete-worktree', true, true);
    await flushPromises();

    expect(closeAgent).toHaveBeenCalledWith(snapshot.agents[0]!.id, {
      deleteWorktree: true,
      deleteRemoteBranch: true,
      discardChanges: true,
      confirmed: true,
    });
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
    const getAgentGitWorkflow = vi.fn();
    const closeAgent = vi.fn().mockResolvedValue({
      ...snapshot,
      agents: snapshot.agents.filter((candidate) => candidate.id !== agent.id),
    });
    setElectronTestClient({
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      getAgentGitWorkflow,
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
    expect(getAgentGitWorkflow).not.toHaveBeenCalled();
  });

  it('does not treat matching folder paths on different backend locations as a shared worktree', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const remoteAgent = {
      ...agent,
      id: 'agent-remote-same-path',
      teamId: 'team-remote',
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
      remoteConnectionId: 'connection-devbox',
      remoteTeamId: 'remote-team',
    });
    const getAgentGitWorkflow = vi.fn().mockResolvedValue({
      repository: 'owner/repo',
      folder: agent.folder,
      isLinkedWorktree: true,
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
      getAgentGitWorkflow,
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

    expect(getAgentGitWorkflow).toHaveBeenCalledWith(agent.id);
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
