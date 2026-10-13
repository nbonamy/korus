import { product } from '@workspace/core/product';
import { config, DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import type {
  CodexComposerMenuSelectableItem,
  CodexNativeAttachment,
  CodexNativeRendererApi,
} from '@codex-app-sdk/vue';
import type { CodexSurfaceClientRequest } from '@codex-app-sdk/core/surface';
import { nextTick, reactive } from 'vue';
import { ElRadio, ElRadioGroup } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../AppShell.vue';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { claudeBackendCapabilities, codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { defaultBackendCommands } from '@workspace/core/backend-commands';
import type { AppApi, RendererMessage } from '@workspace/core/contracts';
import { i18n } from '../../i18n';
import { setElectronTestClient } from '../../test/client';
import { useConfetti } from '../../shared/confetti/use-confetti';
import { setFirstRunOnboardingStage } from '../../onboarding-session';
import { codexConversationSnapshot, codexTextMessage } from '../../test/codex-conversation-fixtures';
import { claudeConversationSnapshot } from '../../test/claude-conversation-fixtures';
import { encodeAppErrorDescriptor } from '@workspace/core/app-error';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';

import {
  conversationControllerActions,
  conversationControllerState,
  clickPortaledMenuItem,
  mountShell as mountRealShell,
  readyBrowserGuest,
} from './app-shell-test-harness';

const mountShell: typeof mountRealShell = (overrides = {}) => mountRealShell({
  ...overrides,
  stubAgentWorkspace: overrides.stubAgentWorkspace ?? true,
  stubRightWorkspacePanel: true,
  stubTeamRail: true,
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

describe('AppShell authentication and conversation', () => {
  it('opens handoff from the sidebar through shell navigation', async () => {
    const wrapper = mountShell({ realAgentSidebar: true });
    await flushPromises();
    await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu', { clientX: 100, clientY: 100 });
    await clickPortaledMenuItem('Hand off…');
    await flushPromises();
    expect(wrapper.find('#agent-handoff-form').exists()).toBe(true);
    expect(wrapper.find('#handoff-instructions').exists()).toBe(true);
  });

  it.each(['codex', 'claude'] as const)('disconnects %s from Settings and offers its sign-in flow again', async backend => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend, installed: true, connected: true, checking: false }];
    const state = backend === 'claude'
      ? { loggedIn: false, configDirectory: '/app/claude-home' }
      : { account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } };
    const disconnectProvider = vi.fn().mockRejectedValueOnce(new Error("Error invoking remote method 'provider:disconnect': Error: Sign-out failed"))
      .mockResolvedValue({ kind: backend, connected: false, state });
    const setProviderEnabled = vi.fn();
    const startCodexChatGptLogin = vi.fn().mockResolvedValue(undefined);
    const getClaudeAuthentication = vi.fn().mockResolvedValue(state);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.app = { disconnectProvider, setProviderEnabled, startCodexChatGptLogin, getClaudeAuthentication } as unknown as AppApi;
    const components = config.global.components;
    config.global.components = { ...components, ElRadio, ElRadioGroup };
    const wrapper = mountRealShell({ snapshot, stubAgentWorkspace: true, stubRightWorkspacePanel: true, stubTeamRail: false });
    config.global.components = components;
    try {
      await flushPromises();
      await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
      await wrapper.get('.settings-sidebar').findAll('.el-menu-item').find(item => item.text() === (backend === 'claude' ? 'Claude Code' : 'Codex'))!.trigger('click');
      await wrapper.get('.settings-view').findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click');
      await flushPromises();
      expect(disconnectProvider).toHaveBeenCalledExactlyOnceWith(backend);
      expect(setProviderEnabled).not.toHaveBeenCalled();
      expect(wrapper.get('.engine-hero__error').text()).toBe('Sign-out failed');
      await wrapper.get('.settings-view').findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click');
      await flushPromises();
      expect(disconnectProvider).toHaveBeenCalledTimes(2);
      expect(wrapper.find('.engine-hero__error').exists()).toBe(false);
      snapshot.providerConnections[0]!.connected = false;
      await wrapper.setProps({ snapshot: { ...snapshot } });
      await wrapper.get('.settings-view').findAll('button').find(button => button.text() === 'Connect')!.trigger('click');
      await flushPromises();
      if (backend === 'claude') {
        const commands = wrapper.findAll('.claude-login-command');
        expect(commands).toHaveLength(2);
        expect(commands[0]!.text()).toContain("CLAUDE_CONFIG_DIR='/app/claude-home' claude auth login --claudeai");
        await commands[0]!.get('button').trigger('click');
        expect(writeText).toHaveBeenLastCalledWith("CLAUDE_CONFIG_DIR='/app/claude-home' claude auth login --claudeai");
        await commands[1]!.get('button').trigger('click');
        expect(writeText).toHaveBeenLastCalledWith("CLAUDE_CONFIG_DIR='/app/claude-home' claude auth login --console");
      } else {
        expect(startCodexChatGptLogin).toHaveBeenCalledOnce();
        expect(wrapper.get('.settings-view').text()).toContain('Cancel sign-in');
      }
    } finally {
      wrapper.unmount();
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it.each(['codex', 'claude'] as const)('applies live follow-up preferences to the %s composer without changing provider routing', async (backend) => {
    const snapshot = createInitialSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.general.followUpBehavior = 'steer';
    snapshot.providerConnections = [{ backend, installed: true, connected: true, checking: false }];
    const agent = snapshot.agents[0]!;
    agent.backend = backend;
    agent.backendDefaults = { kind: backend };
    agent.backendSession = backend === 'claude'
      ? { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' }
      : { kind: 'codex', threadId: 'thread-1' };
    agent.status = { type: 'working' };
    const wrapper = mountShell({
      snapshot, stubAgentWorkspace: false, realConversationPane: true,
      ...(backend === 'claude'
        ? { claudeConversationSnapshot: claudeConversationSnapshot([], { busy: true, activeTurnId: 'turn-1' }) }
        : { codexConversationSnapshot: codexConversationSnapshot([], { busy: true, activeTurnId: 'turn-1' }) }),
      composerState: { text: 'Do this next', selectionStart: 12, selectionEnd: 12 },
      queuedPrompts: [{ id: 'queued-1', agentId: agent.id, text: 'Already queued', createdAt: '2026-10-03T00:00:00Z' }],
    });
    await wrapper.setProps({ backendCapabilities: backend === 'claude' ? claudeBackendCapabilities : codexBackendCapabilities, isSending: true });
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Steer queued prompt now"]').element.disabled).toBe(false);
    await wrapper.get('.chat-rich-text-editor').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('steerPrompt')).toEqual([['Do this next']]);
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
    await wrapper.setProps({
      snapshot: { ...snapshot, general: { ...snapshot.general, followUpBehavior: 'queue' } },
      composerState: { text: 'Save this for later', selectionStart: 18, selectionEnd: 18 },
    });
    await wrapper.get('.chat-rich-text-editor').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(wrapper.emitted('sendPrompt')).toEqual([['Save this for later']]);
    expect(wrapper.emitted('steerPrompt')).toHaveLength(1);
  });

  it('projects Claude approvals into the controlled pane with their exact transcript item identity', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backend = 'claude';
    agent.backendDefaults = { kind: 'claude' };
    agent.backendSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
    const replica = createClaudeConversationReplica(claudeConversationSnapshot([], { agentId: agent.id }));
    const confirmation = { integrationId: 'claude', integrationName: 'Claude', toolName: 'Bash', summary: 'Run the tests?', argumentsPreview: '{"command":"npm test"}', allowConversation: true, allowAlways: false };
    replica.apply({ type: 'approval.requested', agentId: agent.id, backend: 'claude', seq: 1, occurredAt: '2026-10-03T00:00:00Z', turnId: 'turn-approval', payload: { id: 'permission', kind: 'confirm_tool', payload: { confirmation } } });
    const draft = { text: 'Keep my draft', selectionStart: 4, selectionEnd: 4 };
    const attachment: CodexNativeAttachment = { id: 'notes', type: 'file', reference: '/tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 10 };
    const wrapper = mountShell({ snapshot, claudeConversationSnapshot: replica.getSnapshot(), stubAgentWorkspace: false, realConversationPane: true, composerState: draft, composerAttachments: [attachment] });
    expect(conversationControllerState(wrapper).thread?.clientRequests).toStrictEqual([{
      id: 'permission', kind: 'confirm_tool', conversationId: 'claude-session-1', turnId: 'turn-approval', itemId: 'approval-permission', payload: { confirmation },
    }]);
    const footer = wrapper.get('.codex-conversation-pane__footer');
    expect(footer.text()).toContain('Run the tests?');
    expect(wrapper.findAll('.chat-tool-confirmation')).toHaveLength(1);
    expect(wrapper.find('.codex-composer').exists()).toBe(false);
    expect(footer.findAll('button').map(button => button.text())).toEqual(['Allow', 'Allow for session', 'Deny']);
    await footer.findAll('button')[1]!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('client-response')).toEqual([[{ id: 'permission', payload: { decision: 'allow_conversation' } }]]);
    replica.apply({ type: 'clientRequest.resolved', agentId: agent.id, backend: 'claude', seq: 2, occurredAt: '2026-10-03T00:00:01Z', payload: { id: 'permission' } });
    await wrapper.setProps({ claudeConversationSnapshot: replica.getSnapshot() });
    expect(conversationControllerState(wrapper).thread?.clientRequests).toEqual([]);
    expect(conversationControllerState(wrapper).identity.messages).toHaveLength(1);
    expect(wrapper.get('.chat-rich-text-editor').text()).toBe(draft.text);
    expect(wrapper.text()).toContain('notes.txt');
    expect(wrapper.text()).toContain('Allowed tool call');
  });
  it('uses the provider-owned Codex conversation', () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-provider' };
    const providerMessages = [
      codexTextMessage('provider-user', 'user', 'Provider prompt', 'turn-provider'),
      codexTextMessage('provider-assistant', 'assistant', 'Provider response', 'turn-provider'),
    ];
    const providerSnapshot = codexConversationSnapshot(providerMessages, {
      activeConversationId: 'thread-provider',
      activeTurnId: 'turn-provider',
      turnIds: ['turn-provider'],
      turns: [{
        id: 'turn-provider', status: 'inProgress', error: null, willRetry: false,
        startedAt: '2026-09-06T00:00:00.000Z', completedAt: null, durationMs: null,
      }],
      busy: true,
      approvals: [{
        id: 'approval-provider',
        kind: 'command',
        conversationId: 'thread-provider',
        turnId: 'turn-provider',
        itemId: 'item-provider',
        command: 'npm test',
        cwd: '/tmp/project',
        title: 'Run tests',
      }],
    });

    const wrapper = mountShell({
      snapshot,
      stubAgentWorkspace: false,
      codexConversationSnapshot: providerSnapshot,
    });
    const state = conversationControllerState(wrapper);

    expect(state.identity.messages).toStrictEqual(providerMessages);
    expect(state.identity.turns).toStrictEqual(providerSnapshot.turns);
    expect(state.identity.activeTurnId).toBe('turn-provider');
    expect(state.identity.busy).toBe(true);
    expect(state.thread?.approvals).toStrictEqual(providerSnapshot.approvals);
    expect(wrapper.getComponent({ name: 'ConversationPane' }).props('hasVisibleMessages')).toBe(true);
  });

  it('presents a blocking provider question through the controlled pane and forwards its answer', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'thread-question' };
    const question: CodexSurfaceClientRequest = {
      id: 'request-framework', kind: 'ask_user', conversationId: 'thread-question',
      turnId: 'turn-question', itemId: 'item-framework',
      payload: { request: { itemId: 'item-framework', delivery: 'tool', blocking: true,
        questions: [{ id: 'framework', header: 'Framework', question: 'Which framework should I use?',
          isOther: false, isSecret: false,
          options: [{ label: 'Vue', description: 'Use the SDK component package.' }],
        }],
      } },
    };
    const wrapper = mountShell({
      snapshot,
      stubAgentWorkspace: false,
      realConversationPane: true,
      codexConversationSnapshot: codexConversationSnapshot([{
        id: 'assistant-question', role: 'assistant', status: 'streaming', turnId: 'turn-question',
        parts: [{ type: 'tool', id: 'item-framework', kind: 'generic', title: 'ask_user_question',
          status: 'running', metadata: { requestId: question.id },
          statusText: JSON.stringify({ source: 'codex', action: 'ask_user_question', phase: 'running',
            params: { requestId: question.id, questions: question.payload.request.questions } }),
        }],
      }], {
        activeConversationId: 'thread-question',
        activeTurnId: 'turn-question',
        turnIds: ['turn-question'],
        turns: [{ id: 'turn-question', status: 'inProgress', error: null, willRetry: false,
          startedAt: null, completedAt: null, durationMs: null }],
        clientRequests: [question],
        busy: true,
      }),
    });

    expect(wrapper.get('.codex-conversation-pane__footer').text()).toContain('Which framework should I use?');
    expect(wrapper.find('.codex-composer').exists()).toBe(false);
    expect(wrapper.find('.codex-conversation-pane__messages .chat-tool-user-input').exists()).toBe(false);
    await wrapper.get('.codex-conversation-pane__footer button[aria-label="Vue"]').trigger('click');

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      { id: question.id, payload: { answers: { framework: { answers: ['Vue'] } } } },
    ]]);
  });

  it('uses the provider-owned Claude conversation', () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backend = 'claude';
    agent.backendDefaults = { kind: 'claude' };
    agent.backendSession = { kind: 'claude', sessionId: 'claude-session-1', transport: 'stdio' };
    const messages: RendererMessage[] = [{
      id: 'claude-owned', agentId: agent.id, role: 'assistant', status: 'complete', turnId: 'turn-1',
      createdAt: '2026-09-06T00:00:01.000Z', parts: [{ type: 'text', text: 'Provider owned' }],
    }];
    const providerSnapshot = claudeConversationSnapshot(messages, {
      activeTurnId: 'turn-1',
      turnIds: ['turn-1'],
      turns: [{
        id: 'turn-1', status: 'inProgress', error: null, willRetry: false,
        startedAt: '2026-09-06T00:00:01.000Z', completedAt: null, durationMs: null,
      }],
      busy: true,
    });

    const state = conversationControllerState(mountShell({
      snapshot,
      claudeConversationSnapshot: providerSnapshot,
    }));

    expect(state.identity.messages).toStrictEqual(messages);
    expect(state.identity.turns).toStrictEqual(providerSnapshot.turns);
    expect(state.identity.busy).toBe(true);
  });

  it('forwards an edited terminal Codex prompt with its authoritative turn id', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-edit' };
    const providerMessages = [
      codexTextMessage('user-turn-edit', 'user', 'Original prompt', 'turn-edit'),
      codexTextMessage('assistant-turn-edit', 'assistant', 'Original response', 'turn-edit'),
    ];
    const wrapper = mountShell({
      snapshot,
      stubAgentWorkspace: false,
      realConversationPane: true,
      codexConversationSnapshot: codexConversationSnapshot(providerMessages, {
        activeConversationId: 'thread-edit',
        turnIds: ['turn-edit'],
        turns: [{
          id: 'turn-edit', status: 'completed', error: null, willRetry: false,
          startedAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:00:01.000Z', durationMs: 1_000,
        }],
      }),
    });

    await wrapper.get('button[aria-label="Edit"]').trigger('click');
    await wrapper.get('textarea[aria-label="Edit prompt"]').setValue('Edited prompt');
    await wrapper.get('.chat-message__edit-button--primary').trigger('click');

    expect(wrapper.emitted('edit-turn')).toStrictEqual([[
      { content: 'Edited prompt', turnId: 'turn-edit' },
    ]]);
  });

  it('keeps the asynchronous edit action attached so the SDK renders failures', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-edit' };
    const editTurnAction = vi.fn().mockRejectedValue(new Error('Codex rollback timed out'));
    const wrapper = mountShell({
      snapshot,
      stubAgentWorkspace: false,
      realConversationPane: true,
      editTurnAction,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('user-turn-edit', 'user', 'Original prompt', 'turn-edit'),
        codexTextMessage('assistant-turn-edit', 'assistant', 'Original response', 'turn-edit'),
      ], {
        activeConversationId: 'thread-edit',
        turnIds: ['turn-edit'],
        turns: [{
          id: 'turn-edit', status: 'completed', error: null, willRetry: false,
          startedAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:00:01.000Z', durationMs: 1_000,
        }],
      }),
    });

    await wrapper.get('button[aria-label="Edit"]').trigger('click');
    await wrapper.get('textarea[aria-label="Edit prompt"]').setValue('Edited prompt');
    await wrapper.get('.chat-message__edit-button--primary').trigger('click');
    await flushPromises();

    expect(editTurnAction).toHaveBeenCalledWith({ content: 'Edited prompt', turnId: 'turn-edit' });
    expect(wrapper.get('[role="alert"]').text()).toBe('Codex rollback timed out');
  });

  it('preserves promise-returning turn mutation callbacks at the SDK controller boundary', async () => {
    const deleteTurnAction = vi.fn().mockResolvedValue(undefined);
    const editTurnAction = vi.fn().mockResolvedValue(undefined);
    const retryTurnAction = vi.fn().mockResolvedValue(undefined);
    const actions = conversationControllerActions(mountShell({
      deleteTurnAction,
      editTurnAction,
      retryTurnAction,
    }));

    await actions.deleteTurn?.('turn-delete');
    await actions.editTurn?.({ content: 'Edited', turnId: 'turn-edit' });
    await actions.retryTurn?.('turn-retry');

    expect(deleteTurnAction).toHaveBeenCalledWith('turn-delete');
    expect(editTurnAction).toHaveBeenCalledWith({ content: 'Edited', turnId: 'turn-edit' });
    expect(retryTurnAction).toHaveBeenCalledWith('turn-retry');
  });

  it('opens an existing workspace while cached connection data loads, without new authentication probes', async () => {
    let resolveConnections!: (value: []) => void;
    const getCodexAuthentication = vi.fn();
    const getClaudeAuthentication = vi.fn();
    const setMenuBarVisible = vi.fn().mockResolvedValue(undefined);
    window.app = {
      getCodexAuthentication, getClaudeAuthentication,
      setMenuBarVisible,
      getProviderConnections: vi.fn().mockReturnValue(new Promise((resolve) => {
        resolveConnections = resolve;
      })),
    } as Partial<AppApi> as AppApi;

    const wrapper = mountShell();
    await nextTick();

    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.get('.app-shell').classes()).not.toContain('app-shell--auth-gated');
    expect(setMenuBarVisible).toHaveBeenLastCalledWith(true);

    resolveConnections([]);
    await flushPromises();

    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.find('.github-onboarding').exists()).toBe(false);
    expect(getCodexAuthentication).not.toHaveBeenCalled();
    expect(getClaudeAuthentication).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the cached account in engine settings without probing authentication', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false,
      authentication: { kind: 'codex', connected: true, state: {
        account: { type: 'chatgpt', email: 'cached@example.com', planType: 'plus' }, requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      } },
    }];
    const getCodexAuthentication = vi.fn();
    window.app = { getCodexAuthentication } as Partial<AppApi> as AppApi;
    const wrapper = mountRealShell({ snapshot, stubAgentWorkspace: true, stubRightWorkspacePanel: true, stubTeamRail: false });
    await flushPromises();
    await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
    await wrapper.get('.settings-sidebar').findAll('.el-menu-item').find(item => item.text() === 'Codex')!.trigger('click');
    expect(wrapper.get('.settings-view .engine-hero__summary').text()).toContain('cached@example.com');
    expect(getCodexAuthentication).not.toHaveBeenCalled();
  });

  it('saves a skills-only change from Settings for an engine that already has chats', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const setup = { backend: 'codex' as const, installed: true, isolated: true, shareSkills: true, homePath: '/app/codex-home', locked: true };
    const configureProviderSetup = vi.fn().mockResolvedValue({ ...setup, shareSkills: false });
    setElectronTestClient({ getProviderSetup: vi.fn().mockResolvedValue([setup]), configureProviderSetup });
    const wrapper = mountRealShell({ snapshot, stubAgentWorkspace: true, stubRightWorkspacePanel: true, stubTeamRail: false });
    await flushPromises();
    await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
    await wrapper.get('.settings-sidebar').findAll('.el-menu-item').find(item => item.text() === 'Codex')!.trigger('click');
    await wrapper.get('.settings-view').findAll('button').find(button => button.text() === 'Customize')!.trigger('click');
    await flushPromises();
    const dialog = wrapper.getComponent({ name: 'ProviderSetupDialog' });
    await dialog.get('input[type="checkbox"]').setValue(false);
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(configureProviderSetup).toHaveBeenCalledExactlyOnceWith('codex', { isolated: true, shareSkills: false });
    expect(wrapper.find('.provider-setup__acknowledgment').exists()).toBe(false);
  });

  it('routes a confirmed Settings setup switch with the exact agent list', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const setup = { backend: 'codex' as const, installed: true, isolated: true, shareSkills: true, homePath: '/app/codex-home', locked: true, affectedAgentIds: snapshot.agents.map(agent => agent.id) };
    const configureProviderSetup = vi.fn()
      .mockRejectedValueOnce(new Error(`Error invoking remote method 'provider:setup:configure': ${encodeAppErrorDescriptor({ kind: 'appError', code: 'engineSetup.agentsBusy' }, 'diagnostic fallback')}`))
      .mockResolvedValue({ ...setup, isolated: false, locked: false, affectedAgentIds: [] });
    setElectronTestClient({ getProviderSetup: vi.fn().mockResolvedValue([setup]), configureProviderSetup });
    const components = config.global.components;
    config.global.components = { ...components, ElRadio, ElRadioGroup };
    const wrapper = mountRealShell({ snapshot, stubAgentWorkspace: true, stubRightWorkspacePanel: true, stubTeamRail: false });
    config.global.components = components;
    await flushPromises();
    await wrapper.get('.settings-menu').findAll('[role="menuitem"]').find(item => item.text().startsWith('Settings'))!.trigger('click');
    await wrapper.get('.settings-sidebar').findAll('.el-menu-item').find(item => item.text() === 'Codex')!.trigger('click');
    await wrapper.get('.settings-view').findAll('button').find(button => button.text() === 'Customize')!.trigger('click');
    await flushPromises();
    const dialog = wrapper.getComponent({ name: 'ProviderSetupDialog' });
    // Real controls own exclusive selection and the acknowledgment gate.
    expect(dialog.findAll('input[type="radio"]')).toHaveLength(2);
    await dialog.findAll('input[type="radio"]')[1]!.setValue();
    await dialog.get('.app-button--primary').trigger('click');
    expect(configureProviderSetup).not.toHaveBeenCalled();
    await dialog.get('input[type="checkbox"]').setValue(true);
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(configureProviderSetup).toHaveBeenCalledWith('codex', { isolated: false, shareSkills: true, removeAgentIds: setup.affectedAgentIds });
    expect(dialog.get('[role="alert"]').text()).toBe('Wait for this engine’s agents to finish before changing their setup.');
    expect(dialog.text()).not.toContain('Error invoking remote method');
    await dialog.get('.app-button--primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('.provider-setup__acknowledgment').exists()).toBe(false);
  });

  it('offers skippable GitHub setup after the first ChatGPT sign-in', async () => {
    vi.useFakeTimers();
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const setMenuBarVisible = vi.fn().mockResolvedValue(undefined);
    const getCodexAuthentication = vi.fn()
      .mockResolvedValueOnce({
        account: null,
        requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      })
      .mockResolvedValueOnce({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      });
    window.app = {
      getCodexAuthentication,
      setMenuBarVisible,
      startCodexChatGptLogin: vi.fn().mockResolvedValue(undefined),
      updateSettings: vi.fn().mockResolvedValue(snapshot),
    } as Partial<AppApi> as AppApi;

    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(setMenuBarVisible).toHaveBeenLastCalledWith(false);
    await wrapper.get('.codex-login .el-button').trigger('click');
    await flushPromises();
    vi.advanceTimersByTime(1000);
    await flushPromises();
    await wrapper.setProps({ snapshot: { ...snapshot, providerConnections: [{ backend: 'codex', installed: true, connected: true, checking: false }] } });

    expect(wrapper.get('.codex-login').text()).toContain('Codex connected');
    expect(wrapper.find('.github-onboarding').exists()).toBe(false);
    await wrapper.get('.codex-login__continue').trigger('click');
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.get('.github-onboarding').text()).toContain('Connect GitHub.');
    expect(wrapper.get('.app-shell').classes()).toContain('app-shell--auth-gated');
    expect(setMenuBarVisible).toHaveBeenLastCalledWith(false);

    await wrapper.setProps({
      snapshot: {
        ...snapshot,
        workBacklog: {
          ...snapshot.workBacklog,
          connections: [{
            provider: 'github',
            status: 'connected',
            accountLabel: 'nbonamy',
            connectedAt: '2026-09-01T12:00:00.000Z',
          }],
        },
      },
    });

    await nextTick();

    expect(wrapper.find('.github-onboarding').exists()).toBe(false);
    expect(wrapper.get('.onboarding-complete').text()).toContain("You're all set.");
    expect(setMenuBarVisible).toHaveBeenLastCalledWith(false);
    expect(useConfetti().bursts.value).toHaveLength(1);

    await wrapper.get('.onboarding-complete .el-button').trigger('click');

    expect(wrapper.find('.onboarding-complete').exists()).toBe(false);
    expect(wrapper.get('.app-shell').classes()).not.toContain('app-shell--auth-gated');
    expect(setMenuBarVisible).toHaveBeenLastCalledWith(true);
    wrapper.unmount();
  });

  it('shows the same celebrated completion after GitHub is skipped', async () => {
    setFirstRunOnboardingStage('github');
    window.app = {
      getCodexAuthentication: vi.fn().mockResolvedValue({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      }),
    } as Partial<AppApi> as AppApi;

    const wrapper = mountShell();
    await flushPromises();
    const buttons = wrapper.findAll('.github-onboarding .el-button');
    await buttons[1]!.trigger('click');

    expect(wrapper.find('.github-onboarding').exists()).toBe(false);
    expect(wrapper.get('.onboarding-complete').text()).toContain("You're all set.");
    expect(useConfetti().bursts.value).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps provider selection pending across a reload even after Codex signs in', async () => {
    window.app = {
      getCodexAuthentication: vi.fn().mockResolvedValue({
        account: null,
        requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      }),
    } as Partial<AppApi> as AppApi;

    const signedOutShell = mountShell({ snapshot: createEmptySnapshot() });
    await flushPromises();
    signedOutShell.unmount();

    window.app = {
      getCodexAuthentication: vi.fn().mockResolvedValue({
        account: { type: 'chatgpt' },
        requiresOpenaiAuth: true,
        login: { status: 'idle', error: null },
      }),
    } as Partial<AppApi> as AppApi;

    const reloadedSnapshot = createEmptySnapshot();
    reloadedSnapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const reloadedShell = mountShell({ snapshot: reloadedSnapshot });
    await flushPromises();

    expect(reloadedShell.get('.codex-login').text()).toContain('Codex connected');
    expect(reloadedShell.find('.github-onboarding').exists()).toBe(false);
    reloadedShell.unmount();
  });

  it('recognizes an already authenticated Claude during initial provider discovery before it is enabled', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    snapshot.general.claudeCodeEnabled = false;
    window.app = {
      getCodexAuthentication: vi.fn().mockResolvedValue({ account: null, requiresOpenaiAuth: true, login: { status: 'idle', error: null } }),
      getClaudeAuthentication: vi.fn().mockResolvedValue({ loggedIn: true, configDirectory: null }),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(wrapper.findAll('.codex-login__detection')[1]!.text()).toContain('Connected');
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('.claude-login-command').exists()).toBe(false);
  });

  it('connects Claude without Codex and persists onboarding completion rather than enable flags', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const getCodexAuthentication = vi.fn().mockRejectedValue(new Error('Codex unavailable'));
    let finishClaudeCheck!: (result: { loggedIn: boolean; configDirectory: string }) => void;
    const getClaudeAuthentication = vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { finishClaudeCheck = resolve; }))
      .mockResolvedValue({ loggedIn: true, configDirectory: '/tmp/private-claude-home' });
    const updateSettings = vi.fn().mockResolvedValue(snapshot);
    window.app = { getCodexAuthentication, getClaudeAuthentication, updateSettings } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    await wrapper.get('.codex-login__providers').findAll('.el-button')[1]!.trigger('click');
    expect(wrapper.findAll('.claude-login-command').map(command => command.text())).toStrictEqual([
      "CLAUDE_CONFIG_DIR='/app/claude-home' claude auth login --claudeai",
      "CLAUDE_CONFIG_DIR='/app/claude-home' claude auth login --console",
    ]);
    finishClaudeCheck({ loggedIn: false, configDirectory: '/tmp/private-claude-home' });
    await flushPromises();
    expect(document.body.textContent + wrapper.text()).toContain("CLAUDE_CONFIG_DIR='/tmp/private-claude-home' claude auth login --console");
    const checkConnection = wrapper.findAll('button').find(button => button.text() === i18n.global.t('surface.remoteClaudeAuth.refresh'));
    expect(checkConnection).toBeDefined();
    await checkConnection!.trigger('click');
    await flushPromises();
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    await wrapper.setProps({ snapshot: { ...snapshot } });
    expect(wrapper.get('.codex-login').text()).toContain('Claude Code connected');
    expect(wrapper.findAll('.codex-login__detection')[1]!.text()).toContain('Connected');
    expect(wrapper.find('.github-onboarding').exists()).toBe(false);
    await wrapper.get('.codex-login__continue').trigger('click');
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith({ general: { providerOnboardingComplete: true } });
    expect(wrapper.find('.github-onboarding').exists()).toBe(true);
    wrapper.unmount();

    window.sessionStorage.clear();
    snapshot.general.codexEnabled = false;
    snapshot.general.claudeCodeEnabled = true;
    snapshot.general.providerOnboardingComplete = true;
    getCodexAuthentication.mockClear();
    const reloaded = mountShell({ snapshot });
    await flushPromises();
    expect(reloaded.find('.codex-login').exists()).toBe(false);
    expect(reloaded.get('.app-shell').classes()).not.toContain('app-shell--auth-gated');
    expect(getCodexAuthentication).not.toHaveBeenCalled();
    reloaded.unmount();
  });

  it('keeps Antigravity Connect disabled during installation, recovers from failure, and enables it after a retry', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const setup = { backend: 'antigravity' as const, installed: false, isolated: true, shareSkills: false, locked: false, homePath: '/app/antigravity-home' };
    let succeed!: (value: typeof setup) => void;
    let fail!: (error: Error) => void;
    const installProvider = vi.fn(() => new Promise<typeof setup>((resolve, reject) => { succeed = resolve; fail = reject; }));
    const authenticateProvider = vi.fn().mockResolvedValue({ kind: 'antigravity', connected: false, state: { loggedIn: false, homePath: setup.homePath } });
    window.app = { getProviderSetup: vi.fn().mockResolvedValue([setup]), installProvider, authenticateProvider } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    const connect = () => wrapper.findAll('.codex-login__provider button').find(button => button.text() === 'Connect Antigravity')!;
    expect(connect().attributes('disabled')).toBeDefined();
    await wrapper.get('button[aria-label="Install Antigravity"]').trigger('click');
    await flushPromises();
    expect(installProvider).toHaveBeenCalledExactlyOnceWith('antigravity');
    expect(wrapper.get('button[aria-label="Install Antigravity"]').attributes('aria-busy')).toBe('true');
    await connect().trigger('click');
    expect(authenticateProvider).not.toHaveBeenCalled();
    fail(new Error('Download failed'));
    await flushPromises();
    expect(wrapper.get('.codex-login__error').text()).toContain('Download failed');
    expect(wrapper.get('button[aria-label="Install Antigravity"]').attributes('disabled')).toBeUndefined();
    expect(connect().attributes('disabled')).toBeDefined();
    await wrapper.get('button[aria-label="Install Antigravity"]').trigger('click');
    succeed({ ...setup, installed: true });
    await flushPromises();
    expect(wrapper.find('button[aria-label="Install Antigravity"]').exists()).toBe(false);
    expect(wrapper.find('.codex-login__error').exists()).toBe(false);
    expect(connect().attributes('disabled')).toBeUndefined();
    expect(authenticateProvider).not.toHaveBeenCalled();
    await connect().trigger('click');
    await flushPromises();
    expect(authenticateProvider).toHaveBeenCalledExactlyOnceWith('antigravity', 'login');
  });

  it.each([false, true])('redetects an externally installed provider without configuring its home (%s)', async (locked) => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const setup = { backend: 'claude' as const, installed: false, isolated: true, shareSkills: true, locked, homePath: '/app/claude-home' };
    const configureProviderSetup = vi.fn().mockResolvedValue(setup);
    const refreshProvider = vi.fn().mockResolvedValue({ ...setup, installed: true });
    const getClaudeAuthentication = vi.fn().mockResolvedValue({ loggedIn: true, configDirectory: setup.homePath });
    const getCodexAuthentication = vi.fn();
    window.app = {
      getProviderSetup: vi.fn().mockResolvedValue([setup, { ...setup, backend: 'codex', homePath: '/app/codex-home' }]),
      configureProviderSetup, refreshProvider, getClaudeAuthentication, getCodexAuthentication,
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(getCodexAuthentication).not.toHaveBeenCalled();
    await wrapper.findAll('.codex-login__providers .el-button')[1]!.trigger('click');
    await flushPromises();
    expect(getClaudeAuthentication).not.toHaveBeenCalled();
    expect(refreshProvider).not.toHaveBeenCalled();
    expect(wrapper.find('.provider-setup__choices').exists()).toBe(false);
    const recheck = wrapper.findAll('.codex-login__provider')[1]!.findAll('button').find(button => button.attributes('aria-label') === 'Check again');
    await recheck!.trigger('click');
    await flushPromises();
    expect(configureProviderSetup).not.toHaveBeenCalled();
    expect(refreshProvider).toHaveBeenCalledWith('claude');
    expect(getClaudeAuthentication).not.toHaveBeenCalled();
    expect(wrapper.findAll('.codex-login__providers .el-button')[1]!.attributes('disabled')).toBeUndefined();
    await wrapper.setProps({ snapshot: { ...snapshot, providerConnections: [{ backend: 'claude', installed: true, connected: true, checking: false }] } });
    expect(wrapper.get('.codex-login').text()).toContain('Claude Code connected');
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeUndefined();
  });

  it('keeps setup customization unavailable in Welcome until the provider is detected', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const setup = { backend: 'claude' as const, installed: false, isolated: true, shareSkills: true, locked: false, homePath: '/app/claude-home' };
    const configureProviderSetup = vi.fn().mockResolvedValue(setup);
    const refreshProvider = vi.fn();
    const getClaudeAuthentication = vi.fn();
    window.app = {
      getProviderSetup: vi.fn().mockResolvedValue([setup]), configureProviderSetup, refreshProvider, getClaudeAuthentication,
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();
    expect(wrapper.findAll('.codex-login__provider')[1]!.text()).not.toContain('Customize');
    expect(configureProviderSetup).not.toHaveBeenCalled();
    expect(refreshProvider).not.toHaveBeenCalled();
    expect(getClaudeAuthentication).not.toHaveBeenCalled();
    expect(wrapper.get('.provider-install-actions a').text()).toBe('Install');
    wrapper.unmount();
  });

  it.each(['codex', 'claude'] as const)('recognizes existing %s authentication after separation is disabled', async backend => {
    const snapshot = createInitialSnapshot();
    snapshot.agents = [];
    const setups = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, isolated: true, shareSkills: true, locked: false, homePath: `/app/${backend}-home` }));
    const configureProviderSetup = vi.fn().mockResolvedValue({ ...setups.find(setup => setup.backend === backend), isolated: false, homePath: `/existing/${backend}` });
    const startCodexChatGptLogin = vi.fn();
    let finishAuthentication!: () => void;
    const authenticationReady = new Promise<void>(resolve => { finishAuthentication = resolve; });
    window.app = {
      getProviderSetup: vi.fn().mockResolvedValue(setups), configureProviderSetup, startCodexChatGptLogin,
      getCodexAuthentication: vi.fn()
        .mockImplementation(async () => { await authenticationReady; return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true, login: { status: 'idle', error: null } }; }),
      getClaudeAuthentication: vi.fn()
        .mockImplementation(async () => { await authenticationReady; return { loggedIn: true, configDirectory: '/existing/claude' }; }),
    } as Partial<AppApi> as AppApi;
    const wrapper = mount(AppShell, {
      props: { snapshot, activeAgent: null, isLoading: false, isSending: false },
      global: { components: { ElRadio, ElRadioGroup } },
    });
    await flushPromises();
    const index = backend === 'codex' ? 0 : 1;
    await wrapper.findAll('.codex-login__detection button')[index]!.trigger('click');
    const dialog = new DOMWrapper(document.body).get('[role="dialog"]');
    await dialog.get('input[type="radio"][value="false"]').setValue();
    await dialog.get('.app-form-dialog__footer .app-button--primary').trigger('click');
    await flushPromises();
    expect(configureProviderSetup).toHaveBeenCalledWith(backend, { isolated: false, shareSkills: true });
    expect(wrapper.findAll('.codex-login__detection > span').map(status => status.text())).toStrictEqual(
      backend === 'codex' ? ['Checking…', 'Detected'] : ['Detected', 'Checking…'],
    );
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    finishAuthentication();
    await flushPromises();
    await wrapper.setProps({ snapshot: { ...snapshot, providerConnections: [{ backend, installed: true, connected: true, checking: false }] } });
    expect(wrapper.findAll('.codex-login__detection > span').map(status => status.text())).toStrictEqual(
      backend === 'codex' ? ['Connected', 'Detected'] : ['Detected', 'Connected'],
    );
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeUndefined();
    expect(startCodexChatGptLogin).not.toHaveBeenCalled();
  });

  it('keeps the workspace visible while reporting automatic daemon reconnection', () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0] ?? null,
        isLoading: false,
        isSending: false,
        connectionState: { status: 'reconnecting', detail: 'socket closed' },
      },
    });

    expect(wrapper.get('.app-shell__connection-status').text()).toContain('Agents keep working in the background.');
    expect(wrapper.get('.app-shell__connection-status').text()).toContain('socket closed');
    expect(wrapper.find('.app-shell__content').exists()).toBe(true);
  });

  it.each([false, true])('returns an existing workspace to setup when its only engine is unavailable (authenticated=%s)', async connected => {
    const snapshot = createInitialSnapshot();
    snapshot.general.providerOnboardingComplete = true;
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected, enabled: false, checking: false }];
    const setProviderEnabled = vi.fn().mockResolvedValue([{ ...snapshot.providerConnections[0], enabled: true }]);
    const startCodexChatGptLogin = vi.fn().mockResolvedValue(undefined);
    window.app = { setProviderEnabled, startCodexChatGptLogin, updateSettings: vi.fn().mockResolvedValue(snapshot) } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot });
    await flushPromises();

    expect(wrapper.get('.app-shell').classes()).toContain('app-shell--auth-gated');
    expect(wrapper.get('.codex-login__continue').attributes('disabled')).toBeDefined();
    if (connected) {
      const enable = wrapper.findAll('.codex-login__providers .el-button').find(button => button.text().includes('Enable Codex'))!;
      await enable.trigger('click');
      await flushPromises();
      expect(setProviderEnabled).toHaveBeenCalledWith('codex', true);
      expect(startCodexChatGptLogin).not.toHaveBeenCalled();
      await wrapper.setProps({ snapshot: { ...snapshot, providerConnections: [{ ...snapshot.providerConnections[0]!, enabled: true }] } });
      await wrapper.get('.codex-login__continue').trigger('click');
      await flushPromises();
      expect(wrapper.find('.codex-login').exists()).toBe(false);
      expect(wrapper.find('.github-onboarding').exists()).toBe(false);
      expect(wrapper.get('.app-shell').classes()).not.toContain('app-shell--auth-gated');
    }

    wrapper.unmount();
  });

  it('cancels a pending ChatGPT sign-in from the landing screen', async () => {
    const cancelCodexChatGptLogin = vi.fn().mockResolvedValue({
      account: null,
      requiresOpenaiAuth: true,
      login: { status: 'cancelled', error: null },
    });
    window.app = {
      getCodexAuthentication: vi.fn().mockResolvedValue({
        account: null,
        requiresOpenaiAuth: true,
        login: { status: 'pending', error: null },
      }),
      cancelCodexChatGptLogin,
      startCodexChatGptLogin: vi.fn().mockResolvedValue(undefined),
    } as Partial<AppApi> as AppApi;
    const wrapper = mountShell({ snapshot: createEmptySnapshot() });
    await flushPromises();

    await wrapper.get('.codex-login .el-button').trigger('click');
    await flushPromises();

    const cancel = wrapper.get('.codex-login__cancel');
    expect(cancel.classes()).not.toContain('codex-login__cancel--hidden');
    await cancel.trigger('click');
    await flushPromises();

    expect(cancelCodexChatGptLogin).toHaveBeenCalledOnce();
    expect(wrapper.find('.codex-login__cancel').exists()).toBe(false);
    expect(wrapper.find('.codex-login__continue').exists()).toBe(true);

    wrapper.unmount();
  });

  it('composes the phase zero shell around the active agent', () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0];

    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
      },
    });

    expect(wrapper.getComponent({ name: 'AgentSidebar' }).props('teamName')).toBe(product.defaultTeamName);
    expect(wrapper.get('.agent-sidebar__header strong').text()).toBe(product.defaultTeamName);
    expect(wrapper.get(`[aria-label="${product.defaultTeamName}"]`).attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.text()).toContain('Ready to get going');
    expect(wrapper.text()).toContain('Chat with Dina');
    expect(wrapper.text()).not.toContain('Artifacts');
    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('agents')).toStrictEqual(snapshot.agents);
  });

  it('retains structured plan progress after the turn stops', async () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0];
    const plan = {
      threadId: 'thread-plan',
      turnId: 'turn-plan',
      kind: 'execution' as const,
      status: 'inProgress' as const,
      explanation: 'Current execution plan',
      steps: [{ step: 'Implement the fix', status: 'inProgress' as const }],
      markdown: 'Current execution plan\n- [ ] Implement the fix',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    activeAgent.plan = plan;
    activeAgent.backendSession = { kind: 'codex', threadId: 'thread-plan' };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('assistant-plan', 'assistant', '', 'turn-plan'),
        ], {
          activeConversationId: 'thread-plan',
          activeTurnId: 'turn-plan',
          turnIds: ['turn-plan'],
          turns: [{
            id: 'turn-plan', status: 'inProgress', error: null, willRetry: false,
            startedAt: '2026-08-01T00:00:00.000Z', completedAt: null, durationMs: null,
          }],
          busy: true,
        }),
        isLoading: false,
        isSending: true,
      },
    });

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toStrictEqual(plan);
    expect(wrapper.findComponent({ name: 'ConversationPane' }).props()).not.toHaveProperty('turnGitDiff');

    await wrapper.setProps({ isSending: false } as Record<string, unknown>);

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toStrictEqual(plan);
  });

  it('shows the provider-owned Codex execution plan', () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0]!;
    activeAgent.backendSession = { kind: 'codex', threadId: 'thread-plan' };
    const providerSnapshot = codexConversationSnapshot([
      codexTextMessage('assistant-plan', 'assistant', 'Working on it.', 'turn-plan'),
    ], {
      activeConversationId: 'thread-plan',
      activeTurnId: 'turn-plan',
      turnIds: ['turn-plan'],
      executionPlan: {
        turnId: 'turn-plan',
        explanation: 'Current execution plan',
        steps: [{ step: 'Render the mini panel', status: 'inProgress' }],
        markdown: 'Current execution plan\n- [ ] Render the mini panel',
        updatedAt: '2026-09-15T00:00:00.000Z',
      },
    });

    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        codexConversationSnapshot: providerSnapshot,
        isLoading: false,
        isSending: true,
      },
    });

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toStrictEqual({
      threadId: 'thread-plan',
      turnId: 'turn-plan',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Current execution plan',
      steps: [{ step: 'Render the mini panel', status: 'inProgress' }],
      markdown: 'Current execution plan\n- [ ] Render the mini panel',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
  });

  it('shows an active debug execution plan beside newer conversation history', () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0]!;
    activeAgent.backendSession = { kind: 'codex', threadId: 'thread-debug-plan' };
    activeAgent.plan = {
      threadId: 'thread-debug-plan',
      turnId: 'debug-plan-1',
      kind: 'execution',
      status: 'inProgress',
      explanation: 'Debug execution plan',
      steps: [{ step: 'Exercise the execution-plan overlay', status: 'inProgress' }],
      markdown: '- [ ] Exercise the execution-plan overlay',
      updatedAt: '2026-09-15T00:00:00.000Z',
    };

    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        codexConversationSnapshot: codexConversationSnapshot([
          codexTextMessage('assistant-real-turn', 'assistant', 'Existing history.', 'turn-real'),
        ], {
          activeConversationId: 'thread-debug-plan',
          turnIds: ['turn-real'],
        }),
        isLoading: false,
        isSending: false,
      },
    });

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toStrictEqual(activeAgent.plan);
  });

  it('does not flash a persisted plan while conversation history hydrates', async () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0];
    if (!activeAgent) throw new Error('Expected seeded agent.');
    activeAgent.backendSession = { kind: 'codex', threadId: 'thread-persisted' };
    activeAgent.plan = {
      threadId: 'thread-persisted',
      turnId: 'turn-old-plan',
      kind: 'execution',
      status: 'completed',
      explanation: 'Old execution plan',
      steps: [{ step: 'Old completed work', status: 'completed' }],
      markdown: 'Old execution plan\n- [x] Old completed work',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isConversationLoading: true,
        isSending: false,
      },
    });

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toBeNull();
    expect(wrapper.find('.conversation-plan').exists()).toBe(false);

    await wrapper.setProps({
      isConversationLoading: false,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('assistant-newer-turn', 'assistant', 'Newer work completed.', 'turn-newer'),
      ], {
        activeConversationId: 'thread-persisted',
        turnIds: ['turn-newer'],
        turns: [{
          id: 'turn-newer', status: 'completed', error: null, willRetry: false,
          startedAt: '2026-08-02T00:00:00.000Z', completedAt: '2026-08-02T00:00:01.000Z', durationMs: 1_000,
        }],
      }),
    } as Record<string, unknown>);

    expect(wrapper.findComponent({ name: 'ConversationPane' }).props('plan')).toBeNull();
    expect(wrapper.find('.conversation-plan').exists()).toBe(false);
  });

  it('disables only an empty failed conversation and forwards retry', async () => {
    const retryAgentHistory = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      isConversationLoadFailed: true,
      retryAgentHistory,
      stubAgentWorkspace: false,
    });

    expect(conversationControllerState(wrapper).identity.disabled).toBe(true);
    expect(wrapper.getComponent({ name: 'ConversationPane' }).props('historyLoadFailed')).toBe(true);

    wrapper.getComponent({ name: 'ConversationPane' }).vm.$emit('retry-history');
    await flushPromises();
    expect(retryAgentHistory).toHaveBeenCalledOnce();

    const snapshot = createInitialSnapshot();
    const withMessages = mountShell({
      snapshot,
      isConversationLoadFailed: true,
      stubAgentWorkspace: false,
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('message-existing', 'assistant', 'Keep me visible.'),
      ]),
    });
    expect(conversationControllerState(withMessages).identity.disabled).toBe(false);
    expect(withMessages.getComponent({ name: 'ConversationPane' }).props('hasVisibleMessages')).toBe(true);
  });

  it('forwards prompts from the composer', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
      },
    });

    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'hello';
    await editor.trigger('input');
    await nextTick();
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('sendPrompt')).toStrictEqual([['hello']]);
  });

  it('renders the active agent queued prompts above the composer', () => {
    const snapshot = createInitialSnapshot();
    snapshot.queuedPrompts = [{
      id: 'queued-visible',
      agentId: snapshot.activeAgentId!,
      text: 'Run the focused tests next',
      createdAt: '2026-09-08T00:00:00.000Z',
    }];

    const wrapper = mountShell({ snapshot, realConversationPane: true, stubAgentWorkspace: false });

    expect(wrapper.get('[aria-label="Queued prompt"]').text()).toContain('Run the focused tests next');
  });

  it('uses the promise-returning prompt action when the host provides one', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent: snapshot.agents[0],
        isLoading: false,
        isSending: false,
        sendPromptAction,
      },
    });

    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'hello';
    await editor.trigger('input');
    await nextTick();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(sendPromptAction).toHaveBeenCalledWith('hello', undefined);
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
  });

  it.each(['Review', 'Delegate', 'Visualize'])('opens %s from the composer menu without consuming the draft or attachments', async label => {
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const startVisualize = vi.fn().mockResolvedValue(createInitialSnapshot());
    const draft = { text: 'Keep this draft', selectionStart: 4, selectionEnd: 4 };
    const attachment: CodexNativeAttachment = { id: 'notes', type: 'file', reference: '/tmp/notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 10 };
    const wrapper = mountRealShell({ realConversationPane: true, sendPromptAction, startVisualize, composerState: draft, composerAttachments: [attachment] });
    await wrapper.setProps({ backendCapabilities: codexBackendCapabilities, backendCommands: defaultBackendCommands('codex'), approvalPreset: 'ask-for-approval' });
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    if (label === 'Review') {
      expect(wrapper.findAll('.chat-composer-action-menu [role="menuitem"], .chat-composer-action-menu [role="menuitemcheckbox"], .chat-composer-action-menu [role="separator"]')
        .map(row => row.attributes('role') === 'separator' ? '---' : row.text())).toStrictEqual([
        'Approval', '---', 'Review', 'Delegate', 'Visualize', '---', 'Goal mode', 'Plan mode', '---', 'Add Files & Photos',
      ]);
    }
    const item = wrapper.findAll('[role="menuitem"]').find(item => item.text() === label);
    expect(item, `${label} menu item`).toBeDefined();
    await item!.trigger('click');
    await flushPromises();
    if (label === 'Review') expect(wrapper.get('[aria-label="Code review"]').isVisible()).toBe(true);
    if (label === 'Visualize') expect(startVisualize).toHaveBeenCalledExactlyOnceWith(createInitialSnapshot().activeAgentId, undefined);
    if (label === 'Delegate') expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith('/delegate');
    else expect(sendPromptAction).not.toHaveBeenCalled();
    expect(wrapper.get('[role="textbox"][contenteditable]').text()).toBe(draft.text);
    expect(wrapper.emitted('update:composerState')).toBeUndefined();
    expect(wrapper.emitted('update:composerAttachments')).toBeUndefined();
  });

  it.each(['/review', '/reviewer focus on retries'])('intercepts only the exact /review command: %s', async prompt => {
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountRealShell({ realConversationPane: true, sendPromptAction });
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = prompt;
    await editor.trigger('input');
    await nextTick();

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    if (prompt === '/review') {
      expect(sendPromptAction).not.toHaveBeenCalled();
      expect(wrapper.get('[aria-label="Code review"]').isVisible()).toBe(true);
    } else {
      expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith(prompt, undefined);
      expect(wrapper.find('[aria-label="Code review"]').exists()).toBe(false);
    }
  });

  it('clears earlier review instructions when plain /review reopens the same pane', async () => {
    const wrapper = mountRealShell({ realConversationPane: true });
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    for (const prompt of ['/review Focus on retries.', '/review']) {
      editor.element.textContent = prompt;
      await editor.trigger('input');
      await nextTick();
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      const panel = wrapper.get('[aria-label="Code review"]');
      if (prompt === '/review') expect(panel.text()).not.toContain('Additional instructions');
      else expect(wrapper.getComponent({ name: 'CodeReviewPanel' }).props('instructions')).toBe('Focus on retries.');
    }
  });

  it('moves the Review pane from the source thread to an independent reviewer', async () => {
    const snapshot = createInitialSnapshot();
    const source = snapshot.agents[0]!;
    const reviewer = {
      ...source,
      id: 'agent-reviewer',
      name: 'Review',
      backendSession: { kind: 'codex' as const, threadId: 'review-thread' },
    };
    const next = structuredClone(snapshot);
    next.agents.push(reviewer);
    next.teams[0]!.agentIds.push(reviewer.id);
    next.activeAgentId = reviewer.id;
    const startCodeReview = vi.fn().mockResolvedValue(next);
    const wrapper = mountRealShell({ snapshot, startCodeReview });

    wrapper.getComponent({ name: 'RightWorkspacePanel' }).vm.$emit('openTab', 'codeReview');
    await nextTick();
    expect(wrapper.get('[aria-label="Code review"]').isVisible()).toBe(true);

    await wrapper.getComponent({ name: 'AgentWorkspace' }).props('startCodeReview')(
      source.id,
      { scope: { type: 'uncommitted' }, threadMode: 'independent' },
    );
    await wrapper.setProps({ snapshot: next, activeAgent: reviewer });
    await nextTick();

    const reviewerPanel = wrapper.findAllComponents({ name: 'RightWorkspacePanel' })
      .find((panel) => panel.props('agent').id === reviewer.id)!;
    expect(reviewerPanel.isVisible()).toBe(true);
    expect(reviewerPanel.props('tabs')).toContain('codeReview');

    const returned = { ...next, activeAgentId: source.id };
    await wrapper.setProps({ snapshot: returned, activeAgent: source });
    await nextTick();

    const sourcePanel = wrapper.findAllComponents({ name: 'RightWorkspacePanel' })
      .find((panel) => panel.props('agent').id === source.id)!;
    expect(sourcePanel.props('tabs')).not.toContain('codeReview');
    expect(sourcePanel.props('activeTab')).toBeNull();
  });

  it('does not override an independent reviewer with renderer-local model selection', async () => {
    const snapshot = createInitialSnapshot();
    const source = snapshot.agents[0]!;
    source.backendDefaults = {
      kind: 'codex', model: 'gpt-6-astra', reasoningEffort: 'medium',
    };
    const reviewer = {
      ...source,
      id: 'agent-reviewer',
      name: 'Review',
      backendSession: { kind: 'codex' as const, threadId: 'review-thread' },
    };
    const next = structuredClone(snapshot);
    next.agents.push(reviewer);
    next.teams[0]!.agentIds.push(reviewer.id);
    next.activeAgentId = reviewer.id;
    const startCodeReview = vi.fn().mockResolvedValue(next);
    const wrapper = mountRealShell({
      snapshot,
      startCodeReview,
      backendModels: [{
        id: 'astra-option',
        model: 'gpt-6-astra',
        displayName: 'GPT-6 Astra',
      }],
      selectedModelId: 'astra-option',
      selectedReasoningEffort: 'medium',
    });

    wrapper.getComponent({ name: 'RightWorkspacePanel' }).vm.$emit('openTab', 'codeReview');
    await nextTick();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');
    await flushPromises();

    expect(startCodeReview).toHaveBeenCalledExactlyOnceWith(source.id, {
      automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false },
      backend: 'codex',
      scope: { type: 'uncommitted' },
      threadMode: 'independent',
    });
  });

  it('attaches a finding to the real composer and submits the user question through its stable link', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'review-thread' };
    const finding = {
      id: 'finding-1', roundId: 'round-1', priority: 'p1' as const,
      title: 'Authorize before writing',
      body: 'The public mutation writes before checking ownership.',
      location: { file: 'src/auth.ts', line: 42, endLine: 44 },
      decision: { state: 'selected' as const, decidedAt: '2026-09-19T10:00:30.000Z' },
      discussion: [], remediation: { state: 'notStarted' as const },
      createdAt: '2026-09-19T10:00:30.000Z', updatedAt: '2026-09-19T10:00:30.000Z',
    };
    agent.codeReview = {
      id: 'review-1', targetAgentId: agent.id, reviewerAgentId: agent.id,
      scope: { type: 'uncommitted' }, threadMode: 'current', status: 'ready', activeRoundId: 'round-1',
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:01:00.000Z',
      rounds: [{
        id: 'round-1', number: 1, status: 'ready', reviewerSession: agent.backendSession,
        startedAt: '2026-09-19T10:00:00.000Z', completedAt: '2026-09-19T10:01:00.000Z', findings: [finding],
      }],
    };
    const discussCodeReviewFinding = vi.fn().mockResolvedValue(snapshot);
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      realConversationPane: true,
      stubAgentWorkspace: false,
      discussCodeReviewFinding,
      sendPromptAction,
    });

    wrapper.getComponent({ name: 'AgentWorkspace' }).vm.$emit('clarifyCodeReviewFinding', {
      agentId: agent.id,
      sessionId: 'review-1',
      roundId: 'round-1',
      finding,
    });
    await nextTick();

    expect(wrapper.emitted('update:composerState')).toBeUndefined();
    const attachment = wrapper.get('.composer-context-cards__card');
    expect(attachment.text()).toContain('P1');
    expect(attachment.text()).toContain('Authorize before writing');
    expect(attachment.text()).not.toContain('The public mutation writes before checking ownership.');

    const question = 'Could this race with another request?';
    await wrapper.setProps({
      composerState: { text: question, selectionStart: question.length, selectionEnd: question.length },
    });
    await nextTick();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(discussCodeReviewFinding).toHaveBeenCalledExactlyOnceWith(agent.id, {
      sessionId: 'review-1', roundId: 'round-1', findingId: 'finding-1', question,
    });
    expect(sendPromptAction).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-context-cards__card').exists()).toBe(false);
  });

  it('keeps the first submitted prompt visible while its Codex conversation is created', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    delete agent.backendSession;
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({
      snapshot,
      realConversationPane: true,
      stubAgentWorkspace: false,
      sendPromptAction,
    });

    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'Create the first turn';
    await editor.trigger('input');
    await nextTick();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(false);
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);

    agent.backendSession = { kind: 'codex', threadId: 'thread-created' };
    await wrapper.setProps({
      snapshot: { ...snapshot },
      activeAgent: agent,
      codexConversationSnapshot: codexConversationSnapshot([], {
        activeConversationId: 'thread-created',
      }),
    });

    expect(wrapper.find('.codex-conversation-pane__hero').exists()).toBe(false);
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);

    await wrapper.setProps({
      codexConversationSnapshot: codexConversationSnapshot([
        codexTextMessage('authoritative-user', 'user', 'Create the first turn', 'turn-created'),
      ], {
        activeConversationId: 'thread-created',
        turnIds: ['turn-created'],
      }),
    });

    expect(wrapper.findAll('.chat-message--user')).toHaveLength(1);
    expect(wrapper.text().match(/Create the first turn/g)).toHaveLength(1);
  });

  it('owns the SDK conversation controller state and actions at the shell boundary', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
    setElectronTestClient({
      browserOpenVisualization: vi.fn().mockResolvedValue({
        url: '', title: 'Backlog icon candidates', canGoBack: false, canGoForward: false,
      }),
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible: vi.fn().mockResolvedValue(undefined),
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    });
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0];
    if (!activeAgent) throw new Error('Expected seeded agent.');
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    activeAgent.backendSession = { kind: 'codex', threadId: 'thread-dina' };
    const providerSnapshot = codexConversationSnapshot([], {
      activeConversationId: 'thread-dina',
      plugins: [{
        id: 'app-69b31dc2110c8191b8b47dc98fe5a052',
        name: 'dropbox',
        displayName: 'Dropbox',
        enabled: true,
      }],
    });
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
        codexConversationSnapshot: providerSnapshot,
        selectedModelId: 'gpt-5',
        selectedReasoningEffort: 'high',
        selectedServiceTier: 'fast',
        backendPlugins: [{
          id: 'app-69b31dc2110c8191b8b47dc98fe5a052',
          name: 'dropbox',
          displayName: 'Dropbox',
          enabled: true,
        }],
        composerState: { text: 'saved draft', selectionStart: 5, selectionEnd: 5 },
      },
    });

    const state = conversationControllerState(wrapper);
    expect(state.identity).toMatchObject({
      conversationKey: 'codex:thread-dina',
      messages: providerSnapshot.messages,
      busy: false,
      disabled: false,
      activeTurnId: null,
    });
    expect(state.composer).toMatchObject({
      selectedModelId: 'gpt-5',
      selectedReasoningEffort: 'high',
      selectedServiceTier: 'fast',
      state: { text: 'saved draft', selectionStart: 5, selectionEnd: 5 },
    });
    expect(state.catalogs?.plugins).toStrictEqual([{
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      name: 'dropbox',
      displayName: 'Dropbox',
      enabled: true,
    }]);
    expect(state.catalogs?.mentionGroups).toStrictEqual([{
      id: 'agents',
      label: 'Agents',
      placement: 'before',
      items: [{
        id: 'agent-dina',
        value: 'agent:agent-dina',
        label: 'Dina · agent-workspace',
        payload: { agentId: 'agent-dina' },
      }, {
        id: 'agent-jesse',
        value: 'agent:agent-jesse',
        label: 'Jesse · agent-workspace',
        payload: { agentId: 'agent-jesse' },
      }],
    }]);
    expect(state.policy?.canForkTurn).toBe(true);

    const updatedMessages = [codexTextMessage(
      'controller-reactive-message', 'assistant', 'Updated through the stable controller.', 'turn-controller',
    )];
    await wrapper.setProps({
      isSending: true,
      codexConversationSnapshot: codexConversationSnapshot(updatedMessages, {
        activeConversationId: 'thread-dina',
        activeTurnId: 'turn-controller',
        turnIds: ['turn-controller'],
        turns: [{
          id: 'turn-controller', status: 'inProgress', error: null, willRetry: false,
          startedAt: '2026-08-04T00:00:00.000Z', completedAt: null, durationMs: null,
        }],
        busy: true,
      }),
    } as Record<string, unknown>);
    expect(conversationControllerState(wrapper).identity.messages).toStrictEqual(updatedMessages);
    expect(conversationControllerState(wrapper).identity.activeTurnId).toBe('turn-controller');
    expect(wrapper.text()).toContain('Updated through the stable controller.');

    const actions = conversationControllerActions(wrapper);
    await actions.cancel?.();
    expect(wrapper.emitted('interrupt-agent')).toStrictEqual([[]]);
    await actions.sendFollowUp?.('Continue with the fixes');
    expect(wrapper.emitted('sendPrompt')).toStrictEqual([['Continue with the fixes']]);
    await actions.forkTurn?.('turn-3');
    expect(wrapper.emitted('fork-turn')).toStrictEqual([['turn-3']]);
    await actions.updateQueuedPrompt?.('queued-1', 'Edited queued prompt');
    await actions.steerQueuedPrompt?.('queued-1', 'Edited steer');
    expect(wrapper.emitted('update-queued-prompt')).toStrictEqual([['queued-1', 'Edited queued prompt']]);
    expect(wrapper.emitted('steer-queued-prompt')).toStrictEqual([['queued-1', 'Edited steer']]);
    const openExternal = vi.spyOn(window, 'open').mockImplementation(() => null);
    await actions.updateComposerState?.({ text: 'updated', selectionStart: 7, selectionEnd: 7 });
    await actions.updateAttachments?.([{
      id: 'attachment-1',
      type: 'file',
      reference: 'electron-attachment:context',
      name: 'context.txt',
      mimeType: 'text/plain',
      size: 12,
    }]);
    await actions.updateSettings?.({ modelId: 'gpt-5.1', serviceTier: null });
    await actions.submit?.('review context', {
      attachments: [{ type: 'file', reference: 'electron-attachment:context' }],
      model: 'sdk-selection-does-not-cross-host-boundary',
    });
    await actions.openLink?.({ kind: 'external', href: 'https://example.com/docs' });
    const conversationImage = {
      alt: 'Architecture diagram',
      kind: 'attachment',
      mimeType: 'image/png',
      name: 'diagram.png',
      path: '/repo/diagram.png',
      src: 'data:image/png;base64,aW1hZ2U=',
    } as const;
    const fullscreenHandled = await actions.openImage?.(conversationImage, {
      intent: 'fullscreen',
      index: 2,
      message: { id: 'message-with-image', role: 'assistant', content: '' },
    });
    const imageWorkspace = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    expect(fullscreenHandled).toBe(false);
    expect((imageWorkspace.props('tabs') as string[]).some((tab) => tab.startsWith('image:'))).toBe(false);

    const imageHandled = await actions.openImage?.(conversationImage, {
      intent: 'open',
      index: 2,
      message: { id: 'message-with-image', role: 'assistant', content: '' },
    });

    expect(wrapper.emitted('update:composerState')).toStrictEqual([[{
      agentId: activeAgent.id,
      state: { text: 'updated', selectionStart: 7, selectionEnd: 7 },
    }]]);
    expect(wrapper.emitted('update:composerAttachments')).toStrictEqual([[{
      agentId: activeAgent.id,
      attachments: [expect.objectContaining({ reference: 'electron-attachment:context' })],
    }]]);
    expect(wrapper.emitted('select-model')).toStrictEqual([['gpt-5.1']]);
    expect(wrapper.emitted('select-service-tier')).toStrictEqual([[null]]);
    expect(wrapper.emitted('sendPrompt')).toStrictEqual([
      ['Continue with the fixes'],
      [
        'review context',
        { attachments: [{ type: 'file', reference: 'electron-attachment:context' }] },
      ],
    ]);
    expect(openExternal).toHaveBeenCalledWith(
      'https://example.com/docs',
      '_blank',
      'noopener,noreferrer',
    );
    expect(imageHandled).toBe(true);
    const imageTab = (imageWorkspace.props('tabs') as string[]).find((tab) => tab.startsWith('image:'));
    expect(imageTab).toBeDefined();
    expect(imageWorkspace.props('activeTab')).toBe(imageTab);
    expect((imageWorkspace.props('imagePanels') as Record<string, unknown>)[imageTab!]).toStrictEqual({
      kind: 'image',
      title: 'diagram.png',
      subtitle: '/repo/diagram.png',
      path: '/repo/diagram.png',
      mimeType: 'image/png',
      alt: 'Architecture diagram',
      src: 'data:image/png;base64,aW1hZ2U=',
      state: 'idle',
      error: null,
    });
    await actions.openImage?.(conversationImage, {
      intent: 'open',
      index: 2,
      message: { id: 'message-with-image', role: 'assistant', content: '' },
    });
    expect((imageWorkspace.props('tabs') as string[]).filter((tab) => tab === imageTab)).toHaveLength(1);

    imageWorkspace.vm.$emit('closeTab', imageTab);
    await nextTick();
    expect(imageWorkspace.props('tabs')).not.toContain(imageTab);
    expect(imageWorkspace.props('imagePanels')).toStrictEqual({});

    await actions.openVisualization?.({
      path: '/tmp/backlog-icon-candidates.html',
      title: 'Backlog icon candidates',
    });
    await nextTick();
    expect(imageWorkspace.props('tabs')).toContain('browser');
    expect(imageWorkspace.props('activeTab')).toBe('browser');
    expect(imageWorkspace.props('browserInitialUrl')).toBe('');
    expect(imageWorkspace.props('browserVisualization')).toStrictEqual({
      path: '/tmp/backlog-icon-candidates.html',
      title: 'Backlog icon candidates',
    });
  });

  it('contributes persistent model favorites through the SDK model-menu extension', async () => {
    const snapshot = createInitialSnapshot();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const backendModels = [{
      id: 'terra',
      model: 'gpt-5.6-terra',
      displayName: 'GPT-5.6 Terra',
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'high', description: 'Thorough' },
      ],
      defaultReasoningEffort: 'medium',
      serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Fast responses' }],
      defaultServiceTier: null,
      isDefault: true,
    }];
    const wrapper = mountShell({
      snapshot,
      backendModels,
      realConversationPane: true,
      stubAgentWorkspace: false,
      selectedModelId: 'terra',
      selectedReasoningEffort: 'medium',
      selectedServiceTier: 'priority',
      updateSettings,
    });
    const currentFavorite = {
      backend: 'codex' as const,
      modelId: 'terra',
      reasoningEffort: 'medium',
      serviceTier: 'priority',
    };

    const initialItems = conversationControllerState(wrapper).composer?.modelMenuItems ?? [];
    const addCurrent = initialItems.find((item) => item.id === 'model-favorite-add');
    expect(addCurrent).toMatchObject({ label: 'Add current to favorites', type: 'action' });
    await wrapper.get('button[aria-label="Model and reasoning"]').trigger('click');
    await flushPromises();
    const addFavoriteItem = wrapper.findAll('[role="menuitem"]')
      .find((item) => item.text().trim() === 'Add current to favorites');
    expect(addFavoriteItem).toBeDefined();
    await addFavoriteItem!.trigger('click');
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith({ general: { modelFavorites: [currentFavorite] } });

    await wrapper.setProps({
      snapshot: {
        ...snapshot,
        general: { ...snapshot.general, modelFavorites: [currentFavorite] },
      },
    });
    const favoriteItems = conversationControllerState(wrapper).composer?.modelMenuItems ?? [];
    expect(favoriteItems.map((item) => item.type === 'separator' ? item.type : item.label)).toStrictEqual([
      'Favorites',
      'GPT-5.6 Terra',
    ]);
    expect(favoriteItems[1]).toMatchObject({
      type: 'action',
      value: 'Medium',
      valueAppearance: 'badge',
      valueIconLabel: 'Fast',
    });
    const heading = favoriteItems[0];
    if (!heading || heading.type !== 'heading') throw new Error('Expected favorites heading.');
    expect(heading.actions).toHaveLength(2);
    expect(heading.actions?.[0]).toMatchObject({
      disabled: true,
      label: 'Add current to favorites',
    });
    expect(heading.actions?.[1]).toMatchObject({ label: 'Manage favorites' });

    await wrapper.setProps({ selectedReasoningEffort: 'high' });
    await wrapper.get('button[aria-label="Model and reasoning"]').trigger('click');
    await flushPromises();
    const addCurrentButton = wrapper.get('button[aria-label="Add current to favorites"]');
    expect(addCurrentButton.attributes('disabled')).toBeUndefined();
    await addCurrentButton.trigger('click');
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith({
      general: {
        modelFavorites: [currentFavorite, { ...currentFavorite, reasoningEffort: 'high' }],
      },
    });
    expect(() => structuredClone(updateSettings.mock.lastCall?.[0])).not.toThrow();
    await wrapper.setProps({ selectedReasoningEffort: 'medium' });

    conversationControllerActions(wrapper).menuSelect?.(favoriteItems[1] as CodexComposerMenuSelectableItem);
    expect(wrapper.emitted('select-model')).toStrictEqual([['terra']]);
    expect(wrapper.emitted('select-reasoning-effort')).toStrictEqual([['medium']]);
    expect(wrapper.emitted('select-service-tier')).toStrictEqual([['priority']]);

    conversationControllerActions(wrapper).menuSelect?.(heading.actions?.[1] as CodexComposerMenuSelectableItem);
    await nextTick();
    const favoritesDialog = wrapper.getComponent({ name: 'ModelFavoritesDialog' });
    expect(favoritesDialog.props('visible')).toBe(true);
    favoritesDialog.vm.$emit('change', []);
    await flushPromises();
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { modelFavorites: [] } });
  });

  it('treats the reserved default service tier as standard in saved favorites', () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.modelFavorites = [{
      backend: 'codex',
      modelId: 'terra',
      reasoningEffort: 'high',
      serviceTier: 'default',
    }];
    const wrapper = mountShell({
      snapshot,
      backendModels: [{
        id: 'terra',
        model: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        hidden: false,
        supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Thorough' }],
        defaultReasoningEffort: 'high',
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Fast responses' }],
        defaultServiceTier: 'default',
        isDefault: true,
      }],
      realConversationPane: true,
      stubAgentWorkspace: false,
      selectedModelId: 'terra',
      selectedReasoningEffort: 'high',
      selectedServiceTier: 'default',
    });

    const items = conversationControllerState(wrapper).composer?.modelMenuItems ?? [];
    expect(items[1]).toMatchObject({ value: 'High', valueIcon: undefined, valueIconLabel: undefined });
    conversationControllerActions(wrapper).menuSelect?.(items[1] as CodexComposerMenuSelectableItem);
    expect(wrapper.emitted('select-service-tier')).toStrictEqual([[null]]);
  });

  it('exposes Claude permission modes as a distinct composer submenu', async () => {
    const snapshot = createInitialSnapshot();
    const activeAgent = snapshot.agents[0];
    if (!activeAgent) throw new Error('Expected seeded agent.');
    activeAgent.backend = 'claude';
    activeAgent.backendSession = undefined;
    activeAgent.backendDefaults = { kind: 'claude', permissionMode: 'acceptEdits' };
    const wrapper = mount(AppShell, {
      props: {
        snapshot,
        activeAgent,
        isLoading: false,
        isSending: false,
        backendCapabilities: claudeBackendCapabilities,
        permissionMode: 'acceptEdits',
      },
    });

    expect(conversationControllerState(wrapper).capabilities?.approvalPresets).toStrictEqual([]);
    expect(conversationControllerState(wrapper).composer?.leadingMenuItems?.find((item) => item.id === 'backend-permissions')).toEqual(
      expect.objectContaining({
        id: 'backend-permissions',
        type: 'submenu',
        label: 'Permissions',
        items: [
          expect.objectContaining({ id: 'permission-mode:default', label: 'Default', checked: false }),
          expect.objectContaining({ id: 'permission-mode:acceptEdits', label: 'Accept edits', checked: true }),
          expect.objectContaining({ id: 'permission-mode:dontAsk', label: "Don't ask", checked: false }),
          expect.objectContaining({ id: 'permission-mode:auto', label: 'Auto (experimental)', checked: false }),
          expect.objectContaining({
            id: 'permission-mode:bypassPermissions',
            label: 'Dangerously skip permissions',
            checked: false,
          }),
        ],
      }),
    );

    await conversationControllerActions(wrapper).menuSelect?.({
      id: 'permission-mode:bypassPermissions',
      type: 'radio',
      label: 'Dangerously skip permissions',
      checked: false,
      payload: { kind: 'permission-mode', mode: 'bypassPermissions' },
    });
    expect(wrapper.emitted('select-permission-mode')).toStrictEqual([['bypassPermissions']]);
  });

  it('saves, reopens, and submits annotations for multiple composer images', async () => {
    const firstImage: CodexNativeAttachment = {
      id: 'first-image',
      type: 'image',
      reference: 'electron-attachment:first',
      name: 'first.png',
      mimeType: 'image/png',
      size: 128,
      previewUrl: 'data:image/png;base64,Zmlyc3Q=',
    };
    const secondImage: CodexNativeAttachment = {
      ...firstImage,
      id: 'second-image',
      reference: 'electron-attachment:second',
      name: 'second.png',
      previewUrl: 'data:image/png;base64,c2Vjb25k',
    };
    const contextFile: CodexNativeAttachment = {
      id: 'context-file',
      type: 'file',
      reference: 'electron-attachment:context',
      name: 'context.md',
      mimeType: 'text/markdown',
      size: 64,
    };
    const unannotatedImage: CodexNativeAttachment = {
      ...firstImage,
      id: 'unannotated-image',
      reference: 'electron-attachment:unannotated',
      name: 'reference.png',
    };
    const firstAnnotatedAttachment: CodexNativeAttachment = {
      id: 'first-annotated',
      type: 'image',
      reference: 'electron-attachment:first-annotated',
      name: 'first-annotated.png',
      mimeType: 'image/png',
      size: 256,
    };
    const secondAnnotatedAttachment: CodexNativeAttachment = {
      ...firstAnnotatedAttachment,
      id: 'second-annotated',
      reference: 'electron-attachment:second-annotated',
      name: 'second-annotated.png',
    };
    const ingestAttachments = vi.fn().mockResolvedValue([firstAnnotatedAttachment, secondAnnotatedAttachment]);
    (window as Window & { codexAppSdkNative?: Partial<CodexNativeRendererApi> }).codexAppSdkNative = {
      capabilities: {
        attachments: true,
        clipboard: true,
        externalLinks: true,
        transcription: false,
      },
      ingestAttachments,
    };
    const wrapper = mountShell({
      composerAttachments: [firstImage, secondImage, unannotatedImage, contextFile],
      realConversationPane: true,
      stubAgentWorkspace: false,
    });

    await wrapper.get('[aria-label="Annotate first.png"]').trigger('click');
    const dialog = wrapper.getComponent({ name: 'ImageAnnotationDialog' });
    expect(dialog.props('visible')).toBe(true);
    expect(dialog.props('imageSrc')).toBe(firstImage.previewUrl);
    expect(dialog.props('fileName')).toBe('first-annotated.png');

    const firstAnnotations = [
      {
        id: 'annotation-1',
        number: 1,
        tool: 'arrow' as const,
        start: { x: 1, y: 2 },
        end: { x: 3, y: 4 },
        comment: 'Move the button.',
      },
      {
        id: 'annotation-2',
        number: 2,
        tool: 'rectangle' as const,
        start: { x: 5, y: 6 },
        end: { x: 7, y: 8 },
        comment: 'Increase this margin.',
      },
    ];
    dialog.vm.$emit('save', {
      annotations: firstAnnotations,
      dataUrl: 'data:image/png;base64,Zmlyc3QtYW5ub3RhdGVk',
      fileName: 'first-annotated.png',
      height: 80,
      pixelRatio: 1,
      width: 120,
    });
    await nextTick();

    expect(ingestAttachments).not.toHaveBeenCalled();
    expect(wrapper.emitted('sendPrompt')).toBeUndefined();
    expect(wrapper.getComponent({ name: 'ConversationPane' }).props('attachmentAnnotationCounts')).toStrictEqual({
      [firstImage.reference]: 2,
    });
    await wrapper.get('[aria-label="Edit annotations for first.png (2)"]').trigger('click');
    expect(dialog.props('initialAnnotations')).toStrictEqual(firstAnnotations);
    dialog.vm.$emit('close');
    await nextTick();

    await wrapper.get('[aria-label="Annotate second.png"]').trigger('click');
    dialog.vm.$emit('save', {
      annotations: [
        {
          id: 'annotation-second',
          number: 1,
          tool: 'oval',
          start: { x: 9, y: 10 },
          end: { x: 11, y: 12 },
          comment: 'Rename this section.',
        },
      ],
      dataUrl: 'data:image/png;base64,c2Vjb25kLWFubm90YXRlZA==',
      fileName: 'second-annotated.png',
      height: 80,
      pixelRatio: 2,
      width: 120,
    });
    await nextTick();

    await conversationControllerActions(wrapper).submit?.('Please update these screens.', {
      attachments: [
        { type: 'image', reference: firstImage.reference },
        { type: 'image', reference: secondImage.reference },
        { type: 'image', reference: unannotatedImage.reference },
        { type: 'file', reference: contextFile.reference },
      ],
    });
    await flushPromises();

    expect(ingestAttachments).toHaveBeenCalledOnce();
    expect(ingestAttachments.mock.calls[0]?.[0]).toStrictEqual([
      { name: 'first-annotated.png', mimeType: 'image/png', data: expect.any(ArrayBuffer) },
      { name: 'second-annotated.png', mimeType: 'image/png', data: expect.any(ArrayBuffer) },
    ]);
    expect(wrapper.emitted('sendPrompt')).toStrictEqual([[
      [
        'Please update these screens.',
        '',
        'Image annotations:',
        '',
        'Image 1 — first.png',
        '1. Move the button.',
        '2. Increase this margin.',
        '',
        'Image 2 — second.png',
        '1. Rename this section.',
      ].join('\n'),
      {
        attachments: [
          { type: 'image', reference: firstAnnotatedAttachment.reference },
          { type: 'image', reference: secondAnnotatedAttachment.reference },
          { type: 'image', reference: unannotatedImage.reference },
          { type: 'file', reference: contextFile.reference },
        ],
      },
    ]]);
    expect(dialog.props('visible')).toBe(false);

    await conversationControllerActions(wrapper).updateAttachments?.([]);
    expect(wrapper.getComponent({ name: 'ConversationPane' }).props('attachmentAnnotationCounts')).toStrictEqual({});
  });

  it('suspends the browser annotation overlay while the image annotation dialog is open', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    const browserSetVisible = vi.fn().mockResolvedValue(undefined);
    setElectronTestClient({
      browserOpen: vi.fn().mockResolvedValue({ url: '', title: '', canGoBack: false, canGoForward: false }),
      browserSetBounds: vi.fn().mockResolvedValue(undefined),
      browserSetVisible,
      browserClose: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => vi.fn()),
    });
    const wrapper = mountRealShell({
      composerAttachments: [{
        id: 'image-to-annotate',
        type: 'image',
        reference: 'electron-attachment:image-to-annotate',
        name: 'screen.png',
        mimeType: 'image/png',
        size: 128,
        previewUrl: 'data:image/png;base64,c2NyZWVu',
      }],
      realConversationPane: true,
    });

    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await wrapper.findAll('.right-workspace-panel__launcher button')
      .find((button) => button.text().includes('Browser'))
      ?.trigger('click');
    readyBrowserGuest(wrapper.get('webview').element, 42);
    await flushPromises();

    const workspace = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    expect(workspace.props('visible')).toBe(true);
    browserSetVisible.mockClear();

    await wrapper.get('[aria-label="Annotate screen.png"]').trigger('click');
    await flushPromises();

    const dialog = wrapper.getComponent({ name: 'ImageAnnotationDialog' });
    expect(dialog.props('visible')).toBe(true);
    expect(workspace.props('visible')).toBe(false);
    expect(browserSetVisible).toHaveBeenCalledWith('agent-dina', 'primary', false);

    dialog.vm.$emit('close');
    await flushPromises();

    expect(workspace.props('visible')).toBe(true);
    expect(browserSetVisible).toHaveBeenLastCalledWith('agent-dina', 'primary', true);
  });
});
