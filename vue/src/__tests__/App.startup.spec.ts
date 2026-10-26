import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot, createInitialSnapshot } from '@workspace/core/snapshot';
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
  // Guest navigation can fail by being trapped behind onboarding, retaining bearer URLs,
  // showing owner controls, losing saved entries or reapplying a stale navigation response.
  it('joins a deep link as a marked team Quick Chat with a restricted normal composer', async () => {
    const snapshot = createEmptySnapshot();
    const { api, emitAppCommand, emit } = createClientApiMock(snapshot);
    const id = 'a'.repeat(64);
    const entry = { id, name: 'Alex', title: 'Investigate login failures' };
    const other = { id: 'b'.repeat(64), name: 'Alex', title: 'Prepare the release' };
    let state: import('@workspace/core/guest-navigation').GuestJoinState = { entries: [], view: null };
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
    expect(wrapper.text()).toContain('History from before sharing');
    expect(wrapper.text()).toContain('1234abcd');
    expect(wrapper.find('[contenteditable="true"]').exists()).toBe(true);
    expect(wrapper.find('.guest-workspace').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Share"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('synthetic-redacted');
    expect(api.createAgent).not.toHaveBeenCalled(); expect(api.startCodexChatGptLogin).not.toHaveBeenCalled();
    expect(wrapper.find('button[aria-label="Shared with me"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Shared conversation"]').exists()).toBe(true);
    expect(api.sendPrompt).not.toHaveBeenCalled();
    wrapper.unmount();
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
