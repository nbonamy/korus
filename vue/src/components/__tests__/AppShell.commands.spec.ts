import { appApi } from '../../platform-api';
import { setElectronTestClient } from '../../test/client';
import { product } from '@workspace/core/product';
import { flushPromises } from '@vue/test-utils';
import { ElMessageBox } from 'element-plus';
import type {
  CodexNativeAttachment,
  CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import { nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import type { AppCommand, AppApi, Team } from '@workspace/core/contracts';
import { useConfetti } from '../../shared/confetti/use-confetti';
import { codexConversationSnapshot, codexTextMessage } from '../../test/codex-conversation-fixtures';
import { claudeConversationSnapshot } from '../../test/claude-conversation-fixtures';

import {
  clickPortaledMenuItem,
  conversationControllerActions,
  conversationControllerState,
  mountShell as mountRealShell,
  readyBrowserGuest,
} from './app-shell-test-harness';

const mountShell: typeof mountRealShell = (overrides = {}) => mountRealShell({
  stubAgentWorkspace: true,
  ...overrides,
});

vi.mock('../image-annotation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../image-annotation')>(),
  centeredImageCropDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,centered-fallback'),
}));

vi.mock('../../shared/confetti/canvas-celebration', () => ({
  launchCanvasCelebration: vi.fn(),
}));

afterEach(() => {
  useConfetti().clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.removeItem('cockpitGlobalScope:github');
  window.sessionStorage.clear();
  document.body.innerHTML = '';
  delete window.app;
  delete (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative;
});

describe('AppShell dialogs and commands', () => {
  it('can page back to the first Claude request across multiple older pages', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backend = 'claude'; agent.backendSession = { kind: 'claude', sessionId: 'session', transport: 'stdio' };
    const row = (id: string, text: string, role: 'user' | 'assistant' = 'assistant') => ({ id, agentId: agent.id, role, status: 'complete' as const,
      turnId: id, createdAt: '', parts: [{ type: 'text' as const, text }] });
    const recent = row('recent', 'Recent work'), older = row('older', 'Earlier work'), first = row('first', 'Original request', 'user');
    const history = (messages: ReturnType<typeof row>[], hasOlder: boolean) => claudeConversationSnapshot(messages, {
      agentId: agent.id, sessionId: 'session', historyState: { hasOlder, loadingOlder: false },
    });
    const loadOlderAgentHistory = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: false, realConversationPane: true, claudeConversationSnapshot: history([recent], true) });
    try {
      await wrapper.setProps({ loadOlderAgentHistory }); await flushPromises();
      const viewport = wrapper.get<HTMLElement>('.codex-message-list__viewport');
      Object.defineProperty(viewport.element, 'clientHeight', { configurable: true, value: 500 });
      Object.defineProperty(viewport.element, 'scrollHeight', { configurable: true, value: 2000 });
      viewport.element.scrollTop = 0; await viewport.trigger('scroll');
      expect(loadOlderAgentHistory).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ historyLoadingOlder: true });
      await wrapper.setProps({ claudeConversationSnapshot: history([older, recent], true), historyLoadingOlder: false });
      await flushPromises(); viewport.element.scrollTop = 0; await viewport.trigger('scroll');
      expect(loadOlderAgentHistory).toHaveBeenCalledTimes(2);
      await wrapper.setProps({ historyLoadingOlder: true });
      await wrapper.setProps({ claudeConversationSnapshot: history([first, older, recent], false), historyLoadingOlder: false });
      await flushPromises();
      expect(wrapper.text()).toContain('Original request');
    } finally { wrapper.unmount(); }
  });

  it('toggles the uncommitted-changes review simulation through the native command', async () => {
    let listener!: (command: AppCommand) => void;
    window.app = {
      onAppCommand: vi.fn(next => { listener = next; return () => {}; }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.codeReview = {
      id: 'review-1', targetAgentId: agent.id, reviewerAgentId: agent.id,
      scope: { type: 'uncommitted' }, threadMode: 'current', status: 'readyToFinish', activeRoundId: 'round-1',
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:01:00.000Z',
      rounds: [{ id: 'round-1', number: 1, status: 'completed', startedAt: '2026-09-19T10:00:00.000Z', completedAt: '2026-09-19T10:01:00.000Z', findings: [] }],
    };
    const wrapper = mountRealShell({ snapshot, stubAgentWorkspace: false });
    try {
      await flushPromises();
      listener({ type: 'debug-open-code-review' });
      await flushPromises();
      const commitOption = () => wrapper.find('.code-review-panel__footer input[type="checkbox"]').exists();
      expect(commitOption()).toBe(false);
      listener({ type: 'debug-review-uncommitted', enabled: true });
      await flushPromises();
      expect(commitOption()).toBe(true);
      listener({ type: 'debug-review-uncommitted', enabled: false });
      await flushPromises();
      expect(commitOption()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('toggles upgrade previews through the native command and restores actual versions in Settings', async () => {
    let command: (value: AppCommand) => void = () => {};
    const getProviderUpdate = vi.fn(async () => ({ backend: 'claude', status: 'current', installedVersion: '9.0.0', method: 'native', canUpgrade: false, busy: false }));
    const setProviderUpdate = vi.fn();
    window.app = { onAppCommand: vi.fn(listener => { command = listener; return () => {}; }), getProviderUpdate, setProviderUpdate } as unknown as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    const wrapper = mountShell({ snapshot });
    try {
      await flushPromises();
      command({ type: 'debug-provider-upgrades', enabled: true });
      command({ type: 'open-settings' });
      await flushPromises();
      await wrapper.findAll('.settings-sidebar button').find(button => button.text() === 'Claude Code')!.trigger('click');
      await flushPromises();
      expect(wrapper.get('.engine-hero').text()).toContain('1.1.0 available');
      command({ type: 'debug-provider-upgrades', enabled: false });
      await flushPromises();
      expect(wrapper.get('.provider-update__version').text()).toBe('9.0.0');
      expect(setProviderUpdate).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('previews missing local engines in Welcome and Settings without changing real connections', async () => {
    let command: (value: AppCommand) => void = () => {};
    const refreshProvider = vi.fn();
    const installProvider = vi.fn();
    const configureProviderSetup = vi.fn();
    const disconnectProvider = vi.fn();
    const backends = ['codex', 'claude', 'antigravity'] as const;
    window.app = {
      onAppCommand: vi.fn(listener => { command = listener; return () => {}; }),
      getProviderSetup: vi.fn().mockResolvedValue(backends.map(backend => ({
        backend, installed: true, isolated: true, shareSkills: true, homePath: '/home', locked: false,
      }))),
      refreshProvider, installProvider, configureProviderSetup, disconnectProvider,
    } as unknown as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = backends.map(backend => ({
      backend, installed: true, connected: true, checking: false,
    }));
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);

    command({ type: 'debug-missing-engines', enabled: true });
    await flushPromises();
    expect(wrapper.findAll('.codex-login .provider-install-actions a')).toHaveLength(2);
    await wrapper.get('button[aria-label="Install Antigravity"]').trigger('click');
    expect(installProvider).not.toHaveBeenCalled();
    expect(wrapper.findAll('.codex-login__provider').slice(0, 2).some(provider => provider.text().includes('Customize'))).toBe(false);
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.codex-login__provider')[2]!.text()).toContain('Connect Antigravity');
    await wrapper.get('.codex-login .provider-install-actions button').trigger('click');
    expect(refreshProvider).not.toHaveBeenCalled();

    command({ type: 'open-settings' });
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    for (const label of ['Codex', 'Claude Code']) {
      const tab = wrapper.findAll('.settings-sidebar button').find(button => button.text() === label);
      expect(tab).toBeDefined();
      await tab!.trigger('click');
      await flushPromises();
      expect(wrapper.get('.engine-hero').text()).toContain('Not detected');
      expect(wrapper.find('.engine-hero .provider-install-actions a').exists()).toBe(true);
      expect(wrapper.get('.engine-hero [role="switch"]').attributes('disabled')).toBeDefined();
      await wrapper.get('.engine-hero .provider-install-actions button').trigger('click');
    }
    expect(refreshProvider).not.toHaveBeenCalled();
    command({ type: 'debug-missing-engines', enabled: false });
    await flushPromises();
    expect(wrapper.find('.engine-hero .provider-install-actions').exists()).toBe(false);
    expect(wrapper.get('.engine-hero').text()).toContain('Disconnect');
    expect(snapshot.providerConnections.every(engine => engine.installed && engine.connected)).toBe(true);
    expect(configureProviderSetup).not.toHaveBeenCalled();
    expect(disconnectProvider).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([
    { backend: 'codex' as const, command: 'delegate' },
    { backend: 'claude' as const, command: 'worktree' },
  ])(`submits /$command as a ${product.name} command for $backend`, async ({ backend, command }) => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backend = backend;
    snapshot.agents[0]!.backendDefaults = { kind: backend };
    snapshot.providerConnections = [{ backend, installed: true, connected: true, checking: false }];
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ snapshot, realConversationPane: true, sendPromptAction });
    await wrapper.setProps({
      backendCommands: defaultBackendCommands(backend),
      backendSkills: [{ name: 'worktree', path: '/skills/worktree/SKILL.md', enabled: true }],
    });
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = `/${command}`;
    await editor.trigger('input');
    await editor.trigger('keyup');
    await nextTick();
    expect(wrapper.find('[aria-label="Commands and skills"]').exists()).toBe(true);
    await editor.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith(`/${command}`, undefined);
    wrapper.unmount();
  });

  it('continues a restored interrupted Codex turn without submitting a prompt', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const continueInterruptedTurnAction = vi.fn().mockResolvedValue(undefined);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      realConversationPane: true,
      stubAgentWorkspace: false,
      continueInterruptedTurnAction,
      sendPromptAction,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('partial-answer', 'assistant', 'Partial work', 'turn-interrupted'),
      ], {
        activeConversationId: 'thread-dina',
        turnIds: ['turn-interrupted'],
        turns: [{ id: 'turn-interrupted', status: 'interrupted', error: null, willRetry: false,
          startedAt: null, completedAt: null, durationMs: null }],
      }),
    });

    await wrapper.get('button[aria-label="Continue"]').trigger('click');

    expect(continueInterruptedTurnAction).toHaveBeenCalledOnce();
    expect(sendPromptAction).not.toHaveBeenCalled();
  });

  it.each(['Enter', 'Tab'])('keeps /goal pending after %s and submits the objective through the host', async (key) => {
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ realConversationPane: true, sendPromptAction });
    await wrapper.setProps({ backendCommands: defaultBackendCommands('codex') });
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = '/goal';
    await editor.trigger('input');
    await editor.trigger('keyup');
    await nextTick();
    expect(wrapper.find('[aria-label="Commands and skills"]').exists()).toBe(true);
    await editor.trigger('keydown', { key });
    await flushPromises();
    expect(sendPromptAction).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Remove Goal command"]').exists()).toBe(true);
    editor.element.textContent = 'Finish the release';
    await editor.trigger('input');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith('/goal Finish the release', undefined);
    expect(wrapper.find('[aria-label="Remove Goal command"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('starts Visualize from an empty workspace before any Visualize session exists', async () => {
    const snapshot = createInitialSnapshot();
    const startVisualize = vi.fn().mockResolvedValue(snapshot);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, startVisualize, sendPromptAction, stubAgentWorkspace: false });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    const visualizeButton = wrapper.findAll('.right-workspace-panel__launcher button')
      .find(button => button.text() === 'Visualize');
    expect(visualizeButton).toBeDefined();
    await visualizeButton!.trigger('click');
    await flushPromises();

    expect(startVisualize).toHaveBeenCalledExactlyOnceWith('agent-dina', undefined);
    expect(sendPromptAction).not.toHaveBeenCalled();
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toContain('Visualize');
    wrapper.unmount();
  });

  it('removes a newly opened Visualize tab when activation fails', async () => {
    const startVisualize = vi.fn().mockRejectedValue(new Error('Cannot start Visualize'));
    const wrapper = mountShell({ startVisualize, stubAgentWorkspace: false });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    const visualizeButton = wrapper.findAll('.right-workspace-panel__launcher button')
      .find(button => button.text() === 'Visualize');
    await visualizeButton!.trigger('click');
    await flushPromises();

    expect(startVisualize).toHaveBeenCalledExactlyOnceWith('agent-dina', undefined);
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).not.toContain('Visualize');
    wrapper.unmount();
  });

  it('routes /visualize into the dedicated workspace without sending prose to chat', async () => {
    const snapshot = createInitialSnapshot();
    const next = structuredClone(snapshot);
    next.agents[0].visualize = {
      id: 'visualize-1',
      conversationRef: null,
      isOpen: true,
      suggestions: [],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };
    const startVisualize = vi.fn().mockResolvedValue(next);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, startVisualize, sendPromptAction, stubAgentWorkspace: false });

    const forwardPrompt = wrapper.getComponent({ name: 'AgentWorkspace' }).props('forwardPrompt') as (prompt: string) => Promise<void>;
    await forwardPrompt('/visualize focus on the deployment flow');
    await flushPromises();

    expect(startVisualize).toHaveBeenCalledExactlyOnceWith('agent-dina', { prompt: 'focus on the deployment flow' });
    expect(sendPromptAction).not.toHaveBeenCalled();
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toContain('Visualize');
    wrapper.unmount();
  });

  it('opens the populated Visualize pane from the native debug command', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return vi.fn();
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.visualize = {
      id: 'debug-visualize',
      conversationRef: null,
      isOpen: true,
      suggestions: [{ id: 'suggestion-1', title: 'Architecture', description: 'Show the system.' }],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };
    const wrapper = mountShell({ snapshot, stubAgentWorkspace: false });

    listener({ type: 'debug-open-visualize' });
    await nextTick();

    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toContain('Visualize');
    expect(wrapper.text()).toContain('Architecture');
    wrapper.unmount();
  });

  it('marks Visualize closed when the user closes its workspace tab', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.visualize = {
      id: 'visualize-open',
      conversationRef: null,
      isOpen: true,
      suggestions: [],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };
    const setVisualizeOpen = vi.fn().mockResolvedValue(snapshot);
    const wrapper = mountShell({ snapshot, setVisualizeOpen, stubAgentWorkspace: false });

    await wrapper.get('button[aria-label="Close Visualize tab"]').trigger('click');
    await flushPromises();

    expect(setVisualizeOpen).toHaveBeenCalledExactlyOnceWith('agent-dina', { open: false });
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).not.toContain('Visualize');
    wrapper.unmount();
  });

  it('restores the Visualize tab when closing it fails', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.visualize = {
      id: 'visualize-open',
      conversationRef: null,
      isOpen: true,
      suggestions: [],
      visualizations: [],
      selectedVisualizationId: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
    };
    const setVisualizeOpen = vi.fn().mockRejectedValue(new Error('Cannot close Visualize'));
    const wrapper = mountShell({ snapshot, setVisualizeOpen, stubAgentWorkspace: false });

    await wrapper.get('button[aria-label="Close Visualize tab"]').trigger('click');
    await flushPromises();

    expect(setVisualizeOpen).toHaveBeenCalledExactlyOnceWith('agent-dina', { open: false });
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toContain('Visualize');
    wrapper.unmount();
  });

  it('forwards agent move targets from the context menu', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });
    await clickPortaledMenuItem('Skwad');

    expect(wrapper.emitted('move-agent-to-team')).toStrictEqual([[{
      agentId: 'agent-dina',
      teamId: 'team-skwad',
    }]]);
  });

  it('emits keyboard shortcut actions for active teams and agents', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    window.app = {
      browserOpen: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false }),
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });
    const getAgentGitDiff = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ snapshot, getAgentGitDiff });
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true }));
    await flushPromises();
    expect(getAgentGitDiff).toHaveBeenCalledWith('agent-dina');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Changes', 'Browser']);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true }));
    await wrapper.setProps({ activeAgent: snapshot.agents[1] } as Record<string, unknown>);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, cancelable: true }));

    expect(wrapper.emitted('duplicate-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('restart-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('close-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('select-team')).toStrictEqual([['team-skwad']]);
    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse'], ['agent-dina']]);
  });

  it('opens active-agent quick file search with Command-P and previews the keyboard selection', async () => {
    const previewAgentFile = vi.fn().mockResolvedValue({
      path: 'src/main.ts', size: 12, kind: 'text', content: 'export {}',
    });
    const wrapper = mountRealShell({
      agentFiles: [{ name: 'main.ts', path: 'src/main.ts' }],
      previewAgentFile,
    });
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, cancelable: true }));
    await flushPromises();
    const quickOpen = wrapper.getComponent({ name: 'FileQuickOpen' });
    await quickOpen.get('.quick-open-dialog__item').trigger('click');
    await flushPromises();

    expect(previewAgentFile).toHaveBeenCalledWith('agent-dina', 'src/main.ts');
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toContain('main.ts');
  });

  it('opens the agent palette with Command-K and switches teams for the selected unread agent', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      agentIds: ['agent-other'],
    });
    snapshot.agents.push({
      id: 'agent-other',
      teamId: 'team-skwad',
      name: 'Other Agent',
      folder: '/workspace/other',
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
    const wrapper = mountShell({ snapshot, unreadAgentIds: ['agent-other'] });
    await flushPromises();

    const shortcut = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      cancelable: true,
    });
    window.dispatchEvent(shortcut);
    await nextTick();

    expect(shortcut.defaultPrevented).toBe(true);
    const palette = wrapper.getComponent({ name: 'AgentQuickOpen' });
    expect(palette.get('.agent-quick-open__copy strong').text()).toBe('Other Agent');
    await palette.get('input').setValue('skwad');
    await palette.get('input').trigger('keydown.enter');
    await nextTick();

    expect(wrapper.emitted('select-team')).toStrictEqual([['team-skwad']]);
    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-other']]);
    expect(wrapper.findComponent({ name: 'AgentQuickOpen' }).exists()).toBe(false);
  });

  it('toggles spoken acknowledgment mute with Shift-Command-M', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.spokenAnnouncementsEnabled = true;
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mountShell({ snapshot, updateSettings });

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'm',
      metaKey: true,
      shiftKey: true,
      cancelable: true,
    }));
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      general: { spokenAnnouncementsMuted: true },
    });
  });

  it('keeps Antigravity compaction disabled in the sidebar and ignores the native command', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => { listener = nextListener; return () => undefined; }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backend = 'antigravity';
    snapshot.agents[0]!.backendSession = { kind: 'antigravity', sessionId: 'native' };
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });
    listener({ type: 'compact-active-session' });
    await nextTick();
    expect(wrapper.emitted('send-agent-prompt')).toBeUndefined();
    await wrapper.get('.agent-sidebar__agent').trigger('contextmenu');
    const items = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.agent-context-menu [role="menuitem"]'));
    expect(items.find(item => item.textContent?.startsWith('Compact Session'))?.disabled).toBe(true);
  });

  it('compacts the active session from the native shortcut and a targeted agent from its menu', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    snapshot.agents[1]!.backendSession = { kind: 'codex', threadId: 'thread-jesse' };
    const wrapper = mountShell({ snapshot });

    listener({ type: 'compact-active-session' });
    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('compact-session', 'agent-jesse');
    await nextTick();

    expect(wrapper.emitted('send-agent-prompt')).toStrictEqual([
      [{ agentId: 'agent-dina', prompt: '/compact' }],
      [{ agentId: 'agent-jesse', prompt: '/compact' }],
    ]);
  });

  it('forks and opens conversation history for the active agent from native Agent commands', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const wrapper = mountShell({ snapshot });

    listener({ type: 'fork-active-agent' });
    listener({ type: 'resume-active-session' });
    await nextTick();

    expect(wrapper.emitted('fork-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.findComponent({ name: 'ConversationHistoryDialog' }).exists()).toBe(true);
  });

  it('saves and opens drafts from native Edit menu commands', async () => {
    const snapshot = reactive(createInitialSnapshot());
    snapshot.general.savedPromptDrafts = [{ id: 'saved', agentId: 'agent-dina', text: 'Review', content: [{ type: 'mention', kind: 'file', id: 'review.md', label: 'Review', value: 'review.md' }], createdAt: 1 }];
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({
      snapshot,
      stubAgentWorkspace: false,
      realConversationPane: true,
      composerState: { text: 'Park this prompt', selectionStart: 0, selectionEnd: 0 },
      updateSettings,
    });

    listener({ type: 'save-active-prompt-draft' });
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith({
      general: { savedPromptDrafts: [expect.objectContaining({ id: 'saved' }), expect.objectContaining({ agentId: 'agent-dina', text: 'Park this prompt' })] },
    });
    expect(() => structuredClone(updateSettings.mock.calls[0]![0])).not.toThrow();
    listener({ type: 'open-saved-prompt-drafts' });
    await flushPromises();

    expect(wrapper.find('.saved-prompt-draft-picker').exists()).toBe(true);
  });

  it('reveals delayed Command-number hints and switches to the numbered agent', async () => {
    vi.useFakeTimers();
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ realAgentSidebar: true });
    await flushPromises();
    try {
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
      await nextTick();
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
      vi.advanceTimersByTime(350);
      await nextTick();
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
      vi.advanceTimersByTime(350);
      await nextTick();
      expect(wrapper.findAll('.agent-sidebar__quick-switch-shortcut').map((shortcut) => shortcut.text()))
        .toStrictEqual(['⌘1', '⌘2']);

      listener({ type: 'compress-active-session' });
      await nextTick();
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);
      expect(wrapper.emitted('compress-session')).toStrictEqual([['agent-dina']]);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
      vi.advanceTimersByTime(350);
      await nextTick();

      const switchEvent = new KeyboardEvent('keydown', {
        key: '2',
        metaKey: true,
        cancelable: true,
      });
      window.dispatchEvent(switchEvent);
      await nextTick();
      expect(switchEvent.defaultPrevented).toBe(true);
      expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse']]);
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);

      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
      await nextTick();
      expect(wrapper.find('.agent-sidebar__quick-switch-shortcut').exists()).toBe(false);
      expect(wrapper.findAll('.agent-sidebar__status')).toHaveLength(2);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('numbers Activity rows in display order and replaces all trailing indicators while Command is held', async () => {
    vi.useFakeTimers();
    const snapshot = createInitialSnapshot();
    const base = snapshot.agents[0]!;
    snapshot.providerConnections = ['codex', 'claude'].map(backend => ({ backend: backend as 'codex' | 'claude', installed: true, connected: true, checking: false }));
    snapshot.agents = ['idle', 'working', 'unread', 'waiting'].map((id) => ({
      ...base, id, name: id, createdAt: '2026-01-01T00:00:00Z',
      status: { type: id === 'working' ? 'working' as const : id === 'waiting' ? 'awaitingInput' as const : 'idle' as const },
    }));
    snapshot.activeAgentId = 'idle';
    snapshot.teams[0]!.agentIds = snapshot.agents.map(agent => agent.id);
    snapshot.teams[0]!.activeAgentId = 'idle';
    const key = `app:agentOrganization:${snapshot.teams[0]!.id}`;
    localStorage.setItem(key, 'activity');
    const wrapper = mountShell({ snapshot, realAgentSidebar: true, unreadAgentIds: ['unread', 'waiting'] });
    const holdCommand = async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
      vi.advanceTimersByTime(350);
      await nextTick();
    };
    const pressNumber = async (number: number) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: String(number), metaKey: true, cancelable: true }));
      await nextTick();
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    };
    try {
      await flushPromises();
      expect(wrapper.findAll('[data-activity-group] [data-reorder-id]').map(row => row.attributes('data-reorder-id')))
        .toStrictEqual(['waiting', 'unread', 'working', 'idle']);
      expect(wrapper.find('.agent-sidebar__activity-unread').exists()).toBe(true);
      expect(wrapper.find('.agent-sidebar__activity-time').exists()).toBe(true);
      expect(wrapper.find('.agent-sidebar__engine').exists()).toBe(true);
      await holdCommand();
      expect(wrapper.findAll('.agent-sidebar__quick-switch-shortcut').map(hint => hint.text())).toStrictEqual(['⌘1', '⌘2', '⌘3', '⌘4']);
      expect(wrapper.find('.agent-sidebar__activity-indicator, .agent-sidebar__engine').exists()).toBe(false);
      for (const number of [1, 2, 3, 4]) await pressNumber(number);
      expect(wrapper.emitted('select-agent')).toStrictEqual([['waiting'], ['unread'], ['working'], ['idle']]);
      expect(wrapper.find('.agent-sidebar__activity-unread').exists()).toBe(true);
      expect(wrapper.find('.agent-sidebar__activity-time').exists()).toBe(true);

      const updated = { ...snapshot, agents: snapshot.agents.map(agent => ({ ...agent, status: agent.id === 'idle' ? { type: 'awaitingInput' as const } : agent.id === 'waiting' ? { type: 'working' as const } : agent.status })) };
      await wrapper.setProps({ snapshot: updated });
      await holdCommand();
      expect(wrapper.get('[data-reorder-id="idle"] .agent-sidebar__quick-switch-shortcut').text()).toBe('⌘1');
      await pressNumber(1);
      expect(wrapper.emitted('select-agent')?.at(-1)).toStrictEqual(['idle']);
    } finally {
      wrapper.unmount();
      localStorage.removeItem(key);
      vi.useRealTimers();
    }
  });

  it('handles active app commands from the main-process menu channel', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    const listeners = new Set<(command: AppCommand) => void>();
    const listener = (command: AppCommand) => {
      for (const nextListener of listeners) nextListener(command);
    };
    const onAppCommand = vi.fn((nextListener: (command: AppCommand) => void) => {
      listeners.add(nextListener);
      return () => listeners.delete(nextListener);
    });
    window.app = {
      onAppCommand,
      browserOpen: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false }),
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const snapshot = createInitialSnapshot();
    snapshot.general.agentListCompact = true;
    snapshot.teams.push({
      id: 'team-skwad',
      name: 'Skwad',
      avatar: 'SK',
      color: '#46A857',
      agentIds: [],
    });
    const quit = vi.fn().mockResolvedValue(undefined);
    const getAgentGitDiff = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ snapshot, quit, getAgentGitDiff });
    await flushPromises();

    expect(onAppCommand).toHaveBeenCalledOnce();
    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('compact')).toBe(true);
    listener({ type: 'open-whats-new' });
    await nextTick();
    expect(wrapper.getComponent({ name: 'WhatsNewDialog' }).props('visible')).toBe(true);
    wrapper.getComponent({ name: 'WhatsNewDialog' }).vm.$emit('close');
    await nextTick();
    expect(wrapper.getComponent({ name: 'WhatsNewDialog' }).props('visible')).toBe(false);
    listener({ type: 'open-agent-palette' });
    await nextTick();
    expect(wrapper.findComponent({ name: 'AgentQuickOpen' }).exists()).toBe(true);
    wrapper.getComponent({ name: 'AgentQuickOpen' }).vm.$emit('close');
    await nextTick();
    listener({ type: 'new-team' });
    await nextTick();
    expect(wrapper.text()).toContain('Create Team');
    await wrapper.findAll('button').find((button) => button.text() === 'Cancel')?.trigger('click');
    await nextTick();
    listener({ type: 'close-active-agent' });
    listener({ type: 'close-active-team' });
    listener({ type: 'quit' });
    listener({ type: 'cycle-teams' });
    listener({ type: 'cycle-agents', direction: 1 });
    listener({ type: 'duplicate-active-agent' });
    listener({ type: 'restart-active-agent' });
    listener({ type: 'open-review' });
    listener({ type: 'debug-open-code-review' });
    listener({ type: 'open-browser' });
    listener({ type: 'edit-active-agent' });
    await nextTick();
    await flushPromises();

    expect(wrapper.emitted('select-team')).toStrictEqual([['team-skwad']]);
    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse']]);
    expect(wrapper.emitted('close-agent')).toStrictEqual([['agent-dina']]);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('missions and quick chats will be removed'),
      `Close ${product.defaultTeamName}?`,
      {
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Close Team',
        type: 'warning',
      },
    );
    expect(wrapper.emitted('close-team')).toStrictEqual([['team-app']]);
    expect(quit).toHaveBeenCalledOnce();
    expect(wrapper.emitted('duplicate-agent')).toStrictEqual([['agent-dina']]);
    expect(wrapper.emitted('restart-agent')).toStrictEqual([['agent-dina']]);
    expect(getAgentGitDiff).toHaveBeenCalledWith('agent-dina');
    expect(wrapper.get('[aria-label="Right workspace tabs"]').findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Changes', 'Review', 'Browser']);
    expect(wrapper.text()).toContain('Rename agent');

    wrapper.unmount();
    expect(listeners.size).toBe(0);
  });

  it('persists repository icons selected from the session sidebar', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.repositoryIcons = {
      '/src/existing': '🦞',
      '/src/agent-workspace': '🧪',
    };
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, updateSettings });
    const sidebar = wrapper.getComponent({ name: 'AgentSidebar' });

    expect(sidebar.props('repositoryIcons')).toStrictEqual({
      '/src/existing': '🦞',
      '/src/agent-workspace': '🧪',
    });
    sidebar.vm.$emit('update-repository-icon', {
      repositoryKey: 'remote:github.com/nbonamy/agent-workspace',
      repositoryRoot: '/src/agent-workspace',
      icon: '🚀',
    });
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      general: {
        repositoryIcons: {
          '/src/existing': '🦞',
          'remote:github.com/nbonamy/agent-workspace': '🚀',
        },
      },
    });
  });

  it('persists repository group collapse state selected from the session sidebar', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.collapsedRepositoryKeys = ['remote:github.com/nbonamy/existing'];
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, updateSettings });

    wrapper.getComponent({ name: 'AgentSidebar' }).vm.$emit('update-collapsed-repositories', [
      'remote:github.com/nbonamy/agent-workspace',
    ]);
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      general: { collapsedRepositoryKeys: ['remote:github.com/nbonamy/agent-workspace'] },
    });
  });

  it('opens deterministic Markdown, approval, and multi-question fixtures from Debug commands', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountRealShell();

    useConfetti().clear();
    listener({ type: 'debug-celebrate', kind: 'stars' });
    await nextTick();
    expect(useConfetti().bursts.value).toEqual([
      expect.objectContaining({ kind: 'stars' }),
    ]);

    listener({
      type: 'debug-image-annotation',
      imageDataUrl: 'data:image/png;base64,debug-image',
      pixelRatio: 2,
    });
    await flushPromises();

    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('visible')).toBe(true);
    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('imageSrc'))
      .toBe('data:image/png;base64,debug-image');
    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('initialPixelRatio')).toBe(2);
    wrapper.getComponent({ name: 'ImageAnnotationDialog' }).vm.$emit('image-error');
    await flushPromises();
    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('imageSrc'))
      .toBe('data:image/png;base64,centered-fallback');
    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('initialPixelRatio')).toBe(1);
    wrapper.getComponent({ name: 'ImageAnnotationDialog' }).vm.$emit('close');
    await nextTick();
    expect(wrapper.getComponent({ name: 'ImageAnnotationDialog' }).props('visible')).toBe(false);

    listener({ type: 'debug-open-markdown' });
    await nextTick();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Debug Markdown']);
    expect(wrapper.get('.markdown-panel').text()).toContain(`Opened from the ${product.name} Debug menu.`);

    listener({ type: 'debug-approval-request' });
    await nextTick();
    expect(conversationControllerState(wrapper).thread?.approvals).toStrictEqual([expect.objectContaining({
      id: 'debug-approval-request',
      title: 'Allow debug command',
      command: 'npm test -- --run debug-fixture',
    })]);

    await conversationControllerActions(wrapper).resolveApproval?.(
      'debug-approval-request',
      'approve',
      'once',
    );
    await nextTick();

    expect(conversationControllerState(wrapper).thread?.approvals).toStrictEqual([]);
    expect(wrapper.emitted('resolve-approval')).toBeUndefined();

    listener({ type: 'debug-user-questions' });
    await nextTick();
    const questionMessage = conversationControllerState(wrapper).identity.messages.at(-1);
    expect(questionMessage).toMatchObject({ role: 'assistant' });
    expect(questionMessage?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'I need two decisions before continuing.' }),
      expect.objectContaining({
        type: 'question',
        request: expect.objectContaining({ id: 'debug-user-questions' }),
      }),
    ]));
    expect(questionMessage?.parts?.find((part) => part.type === 'question')).toMatchObject({
      request: {
        payload: {
          request: {
            questions: [
              expect.objectContaining({ header: 'Core flow', options: expect.any(Array) }),
              expect.objectContaining({ header: 'Review cadence', options: expect.any(Array) }),
            ],
          },
        },
      },
    });

    await conversationControllerActions(wrapper).clientResponse?.({
      id: 'debug-user-questions',
      payload: { cancelled: true },
    });
    await nextTick();
    expect(conversationControllerState(wrapper).identity.messages).not.toContain(questionMessage);
    expect(wrapper.emitted('client-response')).toBeUndefined();

    listener({ type: 'debug-mark-unread' });
    await nextTick();
    expect(wrapper.emitted('debug-mark-unread')).toStrictEqual([[]]);
  });

  it('hides agent creation progress when it is sent to the background', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell();
    await nextTick();
    listener({ type: 'debug-operation-progress', kind: 'worktreeInitialization' });
    await nextTick();
    const dialog = wrapper.findAllComponents({ name: 'WorkspaceProvisioningProgressDialog' })
      .find((candidate) => candidate.props('operation') !== null);
    if (!dialog) throw new Error('Expected active agent creation progress dialog.');
    const background = dialog.findAll('button').find((button) => button.text() === 'Run in background');
    await background!.trigger('click');
    await nextTick();
    expect(dialog.props('operation')).toBeNull();
  });

  it('shows backend-driven agent creations in the shared dialog and reports its actions', async () => {
    const base = { state: 'running' as const, backend: 'codex' as const, repositoryName: 'agent-workspace', createWorktree: true, hasPrompt: true, phase: 'creatingWorktree' as const };
    const wrapper = mountShell({ agentCreationProgresses: [{ ...base, id: 'agent-creation-1' }, { ...base, id: 'agent-creation-2' }] });
    await nextTick();
    const dialogs = wrapper.findAllComponents({ name: 'WorkspaceProvisioningProgressDialog' });
    const active = dialogs.filter((candidate) => candidate.props('operation') !== null);
    expect(active).toHaveLength(1);
    expect(active[0]!.props('operation')).toMatchObject({ mode: 'batch' });
    await wrapper.findAll('button').find((button) => button.text() === 'Run in background')!.trigger('click');
    expect(wrapper.emitted('background-agent-creation-progress')).toStrictEqual([['agent-creation-1'], ['agent-creation-2']]);
  });

  it('previews the real worktree initialization progress from a Debug command', async () => {
    vi.useFakeTimers();
    let listener: (command: AppCommand) => void = () => undefined;
    const onAppCommand = vi.fn((nextListener: (command: AppCommand) => void) => {
      listener = nextListener;
      return () => undefined;
    });
    window.app = {
      onAppCommand,
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell();
    await nextTick();
    expect(onAppCommand).toHaveBeenCalledOnce();

    listener({ type: 'debug-operation-progress', kind: 'worktreeInitialization' });
    await nextTick();

    const dialog = wrapper.findAllComponents({ name: 'WorkspaceProvisioningProgressDialog' })
      .find((candidate) => candidate.props('operation') !== null);
    if (!dialog) throw new Error('Expected active agent creation progress dialog.');
    expect(dialog.props('operation')).toMatchObject({
      mode: 'single',
      progress: {
        state: 'running',
        createWorktree: true,
        phase: 'creatingWorktree',
        branchName: 'debug/worktree-preview',
      },
    });
    expect(wrapper.text()).toContain('Building an isolated home in agent-workspace');

    await vi.advanceTimersByTimeAsync(1_200);
    expect(dialog.props('operation')).toMatchObject({
      progress: {
        phase: 'initializingWorktree',
        initializationDetail: 'Repository instructions · npm install',
      },
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(dialog.props('operation')).toMatchObject({
      progress: {
        state: 'success',
        agentName: 'debug/worktree-preview',
      },
    });
  });

  it('routes Debug Git progress previews to the active agent workflow control', async () => {
    vi.useFakeTimers();
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    snapshot.agentGitStatuses[agent.id] = {
      folder: agent.folder!,
      repository: 'agent-workspace',
      branch: 'feature/debug-progress',
      ahead: 1,
      behind: 0,
      changedFiles: 0,
      addedLines: 0,
      removedLines: 0,
      hasUntracked: false,
      state: 'clean',
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    const wrapper = mountRealShell({ snapshot });

    listener({ type: 'debug-operation-progress', kind: 'pullRequest' });
    await flushPromises();
    expect(wrapper.text()).toContain('Building handoff report');
    expect(wrapper.text()).toContain('Run in background');

    listener({ type: 'debug-operation-progress', kind: 'merge' });
    await flushPromises();
    expect(wrapper.text()).toContain('Building handoff report');
    expect(wrapper.text()).toContain('Run in background');
  });

  it('attaches a screenshot command to the active agent composer', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const attachment: CodexNativeAttachment = {
      id: 'appshot-image',
      type: 'image',
      reference: 'electron-attachment:appshot',
      name: 'electron-appshot.png',
      mimeType: 'image/png',
      size: 3,
      previewUrl: 'data:image/png;base64,YXBw',
    };
    const ingestAttachments = vi.fn().mockResolvedValue([attachment]);
    (window as Window & { codexAppSdkNative?: Partial<CodexNativeRendererApi> }).codexAppSdkNative = {
      capabilities: {
        attachments: true,
        clipboard: true,
        externalLinks: true,
        transcription: false,
      },
      ingestAttachments,
    };
    const wrapper = mountShell();

    listener({
      type: 'attach-appshot',
      imageDataUrl: 'data:image/png;base64,YXBw',
      appName: 'Electron',
      windowTitle: `${product.name}`,
      accessibilityText: 'Visible and offscreen text',
    });
    await flushPromises();

    expect(ingestAttachments).toHaveBeenCalledWith([{
      name: expect.stringMatching(/^electron-appshot-\d+\.png$/u),
      mimeType: 'image/png',
      data: expect.any(ArrayBuffer),
    }]);
    expect(wrapper.emitted('update:composerAttachments')).toContainEqual([{
      agentId: 'agent-dina',
      attachments: [attachment],
    }]);
  });

  it('selects a deep-linked agent and submits its prompt by default', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });

    listener({
      type: 'open-agent-composer',
      agentId: 'agent-jesse',
      prompt: 'Measure five active conversations',
      submit: true,
    });
    await nextTick();

    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse']]);
    expect(wrapper.emitted('send-agent-prompt')).toStrictEqual([[
      {
        agentId: 'agent-jesse',
        prompt: 'Measure five active conversations',
      },
    ]]);
    expect(wrapper.emitted('update:composerState')).toBeUndefined();
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
  });

  it('opens Settings from the native app command', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell();

    listener({ type: 'open-settings' });
    await nextTick();

    expect(wrapper.find('.settings-view').exists()).toBe(true);
  });

  it('toggles spoken acknowledgment mute from the native app command', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    snapshot.general.spokenAnnouncementsEnabled = true;
    snapshot.general.spokenAnnouncementsMuted = true;
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    mountShell({ snapshot, updateSettings });

    listener({ type: 'toggle-spoken-announcements-muted' });
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      general: { spokenAnnouncementsMuted: false },
    });
  });

  it('prefills a deep-linked agent composer when submission is disabled', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });

    listener({
      type: 'open-agent-composer',
      agentId: 'agent-jesse',
      prompt: 'Measure five active conversations',
      submit: false,
    });
    await nextTick();

    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-jesse']]);
    expect(wrapper.emitted('update:composerState')).toStrictEqual([[
      {
        agentId: 'agent-jesse',
        state: {
          text: 'Measure five active conversations',
          selectionStart: 33,
          selectionEnd: 33,
        },
      },
    ]]);
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
    expect(wrapper.emitted('send-agent-prompt')).toBeUndefined();
  });

  it('opens the requesting agent simulator pane without switching the selected conversation', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    const mobileSimulator = vi.fn().mockResolvedValue({ attachment: null, catalog: { devices: [], setup: [] } });
    window.app = {
      onAppCommand: vi.fn(next => { listener = next; return () => undefined; }),
      mobileSimulator,
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const wrapper = mountRealShell({ snapshot });
    listener({ type: 'open-simulator', agentId: 'agent-jesse' });
    await flushPromises();
    expect(mobileSimulator.mock.calls.every(([agentId]) => agentId === 'agent-jesse')).toBe(true);
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    listener({ type: 'open-simulator', agentId: 'agent-dina' });
    await flushPromises();
    expect(wrapper.get('[aria-label="Mobile simulator"]').text()).toContain('Choose a simulator');
    expect(mobileSimulator).toHaveBeenCalledWith('agent-dina', { action: 'list' });
    expect(wrapper.emitted('select-agent')).toBeUndefined();
    expect(wrapper.findAll('[aria-label="Mobile simulator"]')).toHaveLength(2);
    listener({ type: 'close-simulator', agentId: 'agent-dina' });
    await flushPromises();
    expect(wrapper.findAll('[aria-label="Mobile simulator"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it('opens a model-requested URL in the active agent browser workspace', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    let listener: (command: AppCommand) => void = () => undefined;
    const browserOpen = vi.fn().mockResolvedValue({
      url: 'https://example.com/',
      title: 'Example',
      canGoBack: false,
      canGoForward: false,
    });
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
      browserOpen,
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const wrapper = mountRealShell({ snapshot });

    listener({
      type: 'open-browser',
      agentId: 'agent-dina',
      url: 'https://example.com',
    });
    await nextTick();
    readyBrowserGuest(wrapper.get('webview').element, 42);
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toStrictEqual(['Browser']);
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'primary', 'https://example.com', 42);
    expect((wrapper.get('[aria-label="Browser address"]').element as HTMLInputElement).value).toBe('https://example.com/');
  });

  it('ignores active-agent shortcuts when no agent is selected', () => {
    const snapshot = createEmptySnapshot();
    const wrapper = mountShell({
      snapshot,
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', code: 'Backquote', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true }));

    expect(wrapper.emitted('duplicate-agent')).toBeUndefined();
    expect(wrapper.emitted('close-agent')).toBeUndefined();
    expect(wrapper.emitted('select-team')).toBeUndefined();
    expect(wrapper.emitted('select-agent')).toBeUndefined();
  });

  it('ignores active-agent app commands when no agent or team can handle them', () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
    } as Partial<AppApi> as AppApi;
    const snapshot = createEmptySnapshot();
    snapshot.teams = [];
    snapshot.activeTeamId = null;
    const wrapper = mountShell({ snapshot });

    listener({ type: 'close-active-agent' });
    listener({ type: 'duplicate-active-agent' });
    listener({ type: 'fork-active-agent' });
    listener({ type: 'restart-active-agent' });
    listener({ type: 'resume-active-session' });
    listener({ type: 'edit-active-agent' });
    listener({ type: 'close-active-team' });

    expect(wrapper.emitted('close-agent')).toBeUndefined();
    expect(wrapper.emitted('duplicate-agent')).toBeUndefined();
    expect(wrapper.emitted('fork-agent')).toBeUndefined();
    expect(wrapper.emitted('restart-agent')).toBeUndefined();
    expect(wrapper.findComponent({ name: 'ConversationHistoryDialog' }).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Rename agent');
    expect(wrapper.emitted('close-team')).toBeUndefined();
  });

  it('does not fire keyboard shortcuts while a dialog is open', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot, realAgentSidebar: true });

    await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu');
    await clickPortaledMenuItem('Rename agent');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true }));

    expect(wrapper.emitted('duplicate-agent')).toBeUndefined();
    expect(wrapper.emitted('select-agent')).toBeUndefined();
  });

  it('does not fire app commands while a dialog is open', async () => {
    let listener: (command: AppCommand) => void = () => undefined;
    window.app = {
      onAppCommand: vi.fn((nextListener: (command: AppCommand) => void) => {
        listener = nextListener;
        return () => undefined;
      }),
    } as Partial<AppApi> as AppApi;
    const snapshot = createInitialSnapshot();
    const wrapper = mountShell({ snapshot });

    listener({ type: 'edit-active-agent' });
    await nextTick();
    listener({ type: 'duplicate-active-agent' });
    listener({ type: 'cycle-agents', direction: 1 });

    expect(wrapper.emitted('duplicate-agent')).toBeUndefined();
    expect(wrapper.emitted('select-agent')).toBeUndefined();
  });
});
