import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
import { updateSettingsInSnapshot } from '@workspace/core/settings';
import type { RendererSnapshotState } from '@workspace/core/contracts';
import { createClientApiMock } from '../test/client-api-mock';
import { deferred } from './app-state-test-harness';

let App: typeof import('../App.vue')['default'];
let setElectronTestClient: typeof import('../test/client')['setElectronTestClient'];

beforeEach(async () => {
  vi.resetModules();
  window.sessionStorage.clear();
  // Cold module loading is fixture setup, not part of the startup behavior budget.
  ({ setElectronTestClient } = await import('../test/client'));
  ({ default: App } = await import('../App.vue'));
});
afterEach(() => window.sessionStorage.clear());

function mountStartup(api: ReturnType<typeof createClientApiMock>['api']) {
  setElectronTestClient(api);
  return mount(App);
}

describe('app startup', () => {
  it('keeps a pasted invite in place while background refreshes return an earlier join', async () => {
    vi.useFakeTimers();
    const snapshot = createEmptySnapshot();
    const { api } = createClientApiMock(snapshot);
    api.guestConversationControl.mockImplementation(async input => ({ entries: [], view: {
      id: input.action === 'prepare' ? 'new-invite' : 'previous-invite', name: '', title: 'Sharing', status: 'needsName', participant: null, target: null, frame: null,
    } }));
    const wrapper = mountStartup(api);
    try {
      await flushPromises();
      await wrapper.get('button[aria-label="Join with invite…"]').trigger('click'); await flushPromises();
      const invitation = wrapper.get<HTMLInputElement>('#guest-invitation');
      expect(invitation.element.tagName).toBe('INPUT');
      await invitation.setValue('KORUS1.partially-entered');
      await vi.advanceTimersByTimeAsync(1500); await flushPromises();
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
      expect(wrapper.get<HTMLInputElement>('#guest-invitation').element.value).toBe('KORUS1.partially-entered');
      expect(api.guestConversationControl.mock.calls.some(([input]) => input.action === 'prepare')).toBe(false);
      await invitation.setValue('KORUS1.complete-invitation');
      await invitation.trigger('keyup', { key: 'Enter' }); await flushPromises();
      expect(api.guestConversationControl).toHaveBeenCalledWith(expect.objectContaining({ action: 'prepare', link: 'KORUS1.complete-invitation' }));
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(true);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it('discards a canceled name prompt before retrying the same invite', async () => {
    const snapshot = createEmptySnapshot();
    const { api, emitAppCommand } = createClientApiMock(snapshot);
    const id = 'c'.repeat(64);
    let view: import('@workspace/core/guest-navigation').GuestJoinView | null = null;
    api.guestConversationControl.mockImplementation(async input => {
      if (input.action === 'prepare') view = { id, name: '', title: 'Sharing', status: 'needsName', participant: null, target: null, frame: null };
      if (input.action === 'cancel') view = null;
      return { entries: [], view };
    });
    const wrapper = mountStartup(api);
    try {
      await flushPromises();
      emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
      await wrapper.get('input[autocomplete="nickname"]').setValue('Unsaved');
      await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click'); await flushPromises();
      expect(api.guestConversationControl).toHaveBeenCalledWith({ action: 'cancel', id });
      expect(api.updateSettings).not.toHaveBeenCalled();
      expect(api.guestConversationControl.mock.calls.some(([input]) => input.action === 'join')).toBe(false);
      emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
      expect(wrapper.get<HTMLInputElement>('input[autocomplete="nickname"]').element.value).toBe('');
      expect(api.createQuickChat).not.toHaveBeenCalled();
      expect(api.createAgent).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });
  it('does not finish a dismissed name prompt after its settings save completes', async () => {
    const snapshot = createEmptySnapshot();
    const { api, emitAppCommand } = createClientApiMock(snapshot);
    const pendingSave = deferred<import('@workspace/core/contracts').AppSnapshot>();
    api.updateSettings.mockReturnValue(pendingSave.promise);
    const id = 'd'.repeat(64);
    api.guestConversationControl.mockImplementation(async input => ({ entries: [], view: input.action === 'prepare' ? {
      id, name: '', title: 'Sharing', status: 'needsName', participant: null, target: null, frame: null,
    } : null }));
    const wrapper = mountStartup(api);
    try {
      await flushPromises();
      emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
      await wrapper.get('input[autocomplete="nickname"]').setValue('Alex');
      await wrapper.findAll('button').find(button => button.text() === 'Join conversation')!.trigger('click'); await flushPromises();
      // Escape/backdrop dismissal can happen while the settings RPC is pending.
      wrapper.getComponent({ name: 'FormDialog' }).vm.$emit('update:modelValue', false); await flushPromises();
      emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(true);
      pendingSave.resolve(structuredClone(updateSettingsInSnapshot(snapshot, { general: { guestDisplayName: 'Alex' } }))); await flushPromises();
      expect(api.guestConversationControl.mock.calls.some(([input]) => input.action === 'join')).toBe(false);
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
  it('waits for saved preferences before opening an invite received during startup', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.guestDisplayName = 'Nicolas';
    const { api, emitAppCommand } = createClientApiMock(snapshot);
    const pending = deferred<RendererSnapshotState>();
    api.getSnapshotState.mockReturnValue(pending.promise);
    const entry = { id: 'a'.repeat(64), name: '', title: 'Sharing' };
    api.guestConversationControl.mockImplementation(async input => ({ entries: [], view: input.action === 'state' ? null : {
      ...entry, status: input.action === 'join' ? 'ready' : 'needsName', participant: null, target: null, frame: null,
    } }));
    const wrapper = mountStartup(api);
    try {
      await flushPromises();
      emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
      pending.resolve({ snapshot, connection: { status: 'connected' }, lastBackendEventSeq: 0 });
      await flushPromises();
      expect(api.guestConversationControl).toHaveBeenCalledWith({ action: 'join', id: entry.id, name: 'Nicolas' });
      expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
  // Guest navigation can fail by being trapped behind onboarding, retaining bearer URLs,
  // showing owner controls, losing saved entries or reapplying a stale navigation response.
  it('joins a deep link as a marked team Quick Chat with a restricted normal composer', async () => {
    const snapshot = createEmptySnapshot();
    const { api, emitAppCommand, emit } = createClientApiMock(snapshot);
    const id = 'a'.repeat(64);
    const entry = { id, name: 'Alex', title: 'Investigate login failures' };
    const other = { id: 'b'.repeat(64), name: 'Alex', title: 'Prepare the release' };
    let state: import('@workspace/core/guest-navigation').GuestJoinState = { entries: [], view: null };
    api.updateSettings.mockImplementation(async input => structuredClone(updateSettingsInSnapshot(snapshot, input)));
    api.guestConversationControl.mockImplementation(async input => {
      if (input.action === 'prepare') state = { entries: [], view: { ...entry, name: '', status: 'needsName', participant: null, target: null, frame: null } };
      if (input.action === 'join' || input.action === 'open') state = { entries: [entry, other], view: { ...(input.id === other.id ? other : entry), status: 'ready', participant: { identity: 'fixture', name: 'Alex', discriminator: '1234abcd' }, target: { agentId: 'shared', backend: 'claude', sessionId: 'session', conversation: { backend: 'claude', sessionId: 'session', folder: null } }, frame: { type: 'claude.conversationSnapshotChanged', agentId: 'shared', backend: 'claude', backendSessionId: 'session', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot: { agentId: 'shared', sessionId: 'session', activeTurnId: null, turnIds: [], turns: [], messages: [{ id: 'past', agentId: 'shared', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'History from before sharing' }], createdAt: 'now' }], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } } } };
      if (input.action === 'leave') state = { entries: [], view: null };
      if (input.action === 'join' || input.action === 'open') {
        snapshot.agents = [{ id: 'shared-row', teamId: snapshot.teams[0]!.id, name: entry.title, sessionKind: 'quickChat', sharedConversation: { joinId: id }, backend: 'codex', folder: null, status: { type: 'idle' }, createdAt: 'now', updatedAt: 'now' }];
        snapshot.teams[0]!.agentIds = ['shared-row']; snapshot.activeAgentId = 'shared-row';
        emit({ type: 'snapshot.updated', seq: 10, occurredAt: 'now', payload: structuredClone(snapshot) });
      }
      return structuredClone(state);
    });
    let wrapper = mountStartup(api); await flushPromises();
    expect(wrapper.find('.codex-login--sign-in').exists()).toBe(true);
    emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
    expect(wrapper.text()).toContain('Join conversation');
    const name = wrapper.get('input[autocomplete="nickname"]'); await name.setValue('Alex');
    await wrapper.findAll('button').find(button => button.text() === 'Join conversation')!.trigger('click'); await flushPromises();
    expect(api.updateSettings).toHaveBeenCalledWith({ general: { guestDisplayName: 'Alex' } });
    expect(wrapper.text()).toContain('History from before sharing');
    expect(wrapper.text()).not.toContain('1234abcd');
    expect(wrapper.get('.agent-header [role="status"]').text()).toContain('Connected');
    expect(wrapper.get('.agent-header').text()).not.toContain('Alex');
    expect(wrapper.find('[contenteditable="true"]').exists()).toBe(true);
    expect(wrapper.find('.guest-workspace').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Share"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('synthetic-redacted');
    expect(api.createAgent).not.toHaveBeenCalled(); expect(api.startCodexChatGptLogin).not.toHaveBeenCalled();
    expect(wrapper.find('button[aria-label="Shared with me"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Shared conversation"]').exists()).toBe(true);
    expect(api.sendPrompt).not.toHaveBeenCalled();
    const joins = api.guestConversationControl.mock.calls.filter(([input]) => input.action === 'join').length;
    emitAppCommand({ type: 'open-shared-conversation', link: 'synthetic-redacted' }); await flushPromises();
    expect(api.guestConversationControl.mock.calls.filter(([input]) => input.action === 'join')).toHaveLength(joins + 1);
    expect(wrapper.find('input[autocomplete="nickname"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('keeps a revoked shared chat in an access-ended screen until Close without opening the invite dialog', async () => {
    vi.useFakeTimers();
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const agent = snapshot.agents[0]!;
    const id = 'e'.repeat(64);
    agent.sharedConversation = { joinId: id }; agent.sessionKind = 'quickChat'; agent.folder = null;
    snapshot.activeAgentId = agent.id;
    const { api, emit } = createClientApiMock(snapshot);
    const entry = { id, name: 'Alex', title: 'Sharing' };
    let state: import('@workspace/core/guest-navigation').GuestJoinState = { entries: [entry], view: { ...entry, status: 'ready', participant: null, target: null, frame: null } };
    let failClose = true;
    api.guestConversationControl.mockImplementation(async input => {
      if (input.action === 'leave') {
        if (failClose) { failClose = false; throw new Error('Storage unavailable'); }
        state = { entries: [], view: null };
        snapshot.agents = snapshot.agents.filter(row => row.id !== agent.id);
        snapshot.teams.forEach(team => { team.agentIds = team.agentIds.filter(row => row !== agent.id); });
        snapshot.activeAgentId = snapshot.agents[0]?.id ?? null;
        emit({ type: 'snapshot.updated', seq: 10, occurredAt: 'now', payload: structuredClone(snapshot) });
      }
      return structuredClone(state);
    });
    const wrapper = mountStartup(api);
    try {
      await flushPromises();
      expect(wrapper.find('.shared-conversation-pane').exists()).toBe(true);
      state = { entries: [entry], view: { ...entry, status: 'rejected', participant: null, target: null, frame: null } };
      await vi.advanceTimersByTimeAsync(750); await flushPromises();
      expect(wrapper.find('#guest-invitation').exists()).toBe(false);
      const ended = wrapper.get('.shared-conversation-pane');
      expect(ended.text()).toContain('This conversation is no longer accessible.');
      expect(wrapper.find('.agent-header button[aria-label="Leave"]').exists()).toBe(false);
      expect(ended.find('[contenteditable]').exists()).toBe(false);
      const close = ended.findAll('button').find(button => button.text() === 'Close')!;
      await close.trigger('click'); await flushPromises();
      expect(ended.get('[role="alert"]').text()).toContain('Check local storage');
      expect(wrapper.find('#guest-invitation').exists()).toBe(false);
      await close.trigger('click'); await flushPromises();
      expect(api.guestConversationControl).toHaveBeenLastCalledWith({ action: 'leave', id });
      expect(wrapper.find('.shared-conversation-pane').exists()).toBe(false);
      expect(wrapper.find('#guest-invitation').exists()).toBe(false);
    } finally { wrapper.unmount(); vi.useRealTimers(); }
  });
  it('waits for the saved workspace before deciding whether to show onboarding', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api } = createClientApiMock(snapshot);
    const pending = deferred<RendererSnapshotState>();
    api.getSnapshotState.mockReturnValue(pending.promise);
    const wrapper = await mountStartup(api);
    await flushPromises();

    expect(wrapper.find('.codex-login--sign-in').exists()).toBe(false);
    expect(window.sessionStorage.getItem('app:firstRunOnboardingStage')).toBeNull();
    pending.resolve({ snapshot, connection: { status: 'connected' }, lastBackendEventSeq: 0 });
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.text()).toContain('Dina');
    wrapper.unmount();
  });

  it.each(['rejected', 'disconnected'] as const)('shows a connection problem, not onboarding, after a %s initial snapshot and recovers', async mode => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api, emit } = createClientApiMock(snapshot);
    if (mode === 'rejected') api.getSnapshotState.mockRejectedValueOnce(new Error('daemon socket is not connected.'));
    else api.getSnapshotState.mockResolvedValueOnce({ snapshot: createEmptySnapshot(), connection: { status: 'error', detail: 'daemon socket is not connected.' }, lastBackendEventSeq: 0 });
    const wrapper = await mountStartup(api);
    await flushPromises();

    expect(wrapper.find('.codex-login--sign-in').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('daemon socket is not connected.');
    expect(window.sessionStorage.getItem('app:firstRunOnboardingStage')).toBeNull();
    emit({ type: 'client.connectionChanged', source: 'client', payload: { status: 'connected' }, seq: 0, occurredAt: '2026-10-06T00:00:00Z' });
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.text()).toContain('Dina');
    wrapper.unmount();
  });

  it.each(['cached', 'rejected'] as const)('re-reads the workspace when the daemon connects during a %s initial snapshot request', async mode => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api, emit } = createClientApiMock(snapshot);
    const pending = deferred<RendererSnapshotState>();
    api.getSnapshotState.mockReturnValueOnce(pending.promise);
    const wrapper = await mountStartup(api);
    await flushPromises();
    emit({ type: 'client.connectionChanged', source: 'client', payload: { status: 'connected' }, seq: 0, occurredAt: '2026-10-06T00:00:00Z' });
    if (mode === 'rejected') pending.reject(new Error('daemon socket is not connected.'));
    else pending.resolve({ snapshot: createEmptySnapshot(), connection: { status: 'connecting' }, lastBackendEventSeq: 0 });
    await flushPromises();

    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.text()).toContain('Dina');
    expect(window.sessionStorage.getItem('app:firstRunOnboardingStage')).toBeNull();
    wrapper.unmount();
  });

  it('allows retry after startup fails without waiting for a transport event', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api } = createClientApiMock(snapshot);
    api.getSnapshotState.mockRejectedValueOnce(new Error('snapshot unavailable'));
    const wrapper = await mountStartup(api);
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.text()).toContain('Dina');
    wrapper.unmount();
  });

  it('still offers onboarding for a confirmed fresh install', async () => {
    const { api } = createClientApiMock(createEmptySnapshot());
    const wrapper = await mountStartup(api);
    await flushPromises();
    expect(wrapper.find('.codex-login--sign-in').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the workspace visible through a later disconnect and a failed provider probe', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api, emit } = createClientApiMock(snapshot);
    api.getProviderSetup.mockRejectedValue(new Error('provider probe unavailable'));
    api.getProviderConnections.mockRejectedValue(new Error('provider probe unavailable'));
    const wrapper = await mountStartup(api);
    await flushPromises();
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    emit({ type: 'client.connectionChanged', source: 'client', payload: { status: 'reconnecting' }, seq: 0, occurredAt: '2026-10-06T00:00:00Z' });
    await flushPromises();
    expect(wrapper.text()).toContain('Dina');
    expect(wrapper.find('.codex-login').exists()).toBe(false);
    expect(wrapper.get('.app-shell__connection-status').text()).toContain('Reconnecting');
    wrapper.unmount();
  });
});
