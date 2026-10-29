import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { ConversationShareControl } from '@workspace/core/conversation-sharing';
import { setElectronTestClient } from '../../test/client';
import { mountShell, clickPortaledMenuItem } from './app-shell-test-harness';
import type { GuestJoinView } from '@workspace/core/guest-navigation';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import { createClientApiMock } from '../../test/client-api-mock';

// Mounted shell catches entry-point routing, duplicate grants, missing disclosure,
// stale async results and accidental credential display. Provider UI is a boundary fake.
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

/** Active shares have a header button; inactive shares use the agent actions menu. */
async function openShareDialog(wrapper: { element: Element }) {
  const share = wrapper.element.querySelector<HTMLElement>('.agent-header__activity button[aria-label="Share"]');
  if (share) {
    share.click();
  } else {
    const more = wrapper.element.querySelector<HTMLElement>('.agent-header__activity button[aria-label="Agent actions"]');
    expect(more).not.toBeNull();
    more!.click();
    await flushPromises();
    const item = Array.from(wrapper.element.querySelectorAll<HTMLElement>('.agent-header__activity [role="menuitem"]')).find(candidate => candidate.textContent?.trim() === 'Share');
    expect(item).toBeDefined();
    item!.click();
  }
  await flushPromises();
}
describe('owner Share workflow', () => {
  it('renders pushed suggestions without reloading and moves or deletes them without submitting', async () => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    agent.backend = 'claude'; agent.backendSession = { kind: 'claude', sessionId: 'owner', transport: 'stdio' };
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    const proposal = { id: '11111111-1111-4111-8111-111111111111', handle: 'a'.repeat(32), identity: 'guest-identity', name: 'Alex', discriminator: '1234abcd', text: 'Please inspect the retry path', status: 'pending' as const, createdAt: 'now' };
    const second = { ...proposal, id: '22222222-2222-4222-8222-222222222222', text: 'Another suggestion' };
    let proposals: typeof proposal[] = [];
    const control = vi.fn(async (input: ConversationShareControl) => {
      if (input.action === 'dismiss') proposals = proposals.filter(proposal => proposal.id !== input.proposalId);
      return { state: { active: true, handle: proposal.handle, connectedGuests: 1, availability: 'ready' as const, proposals } };
    });
    const client = createClientApiMock();
    setElectronTestClient({ conversationShareControl: control, onEvent: client.api.onEvent });
    const wrapper = mountShell({ snapshot, composerState: { text: 'Existing draft', selectionStart: 14, selectionEnd: 14 }, realConversationPane: true, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises();
      expect(wrapper.find('[aria-label="Suggestions"]').exists()).toBe(false);
      const readsBeforeUpdate = control.mock.calls.length;
      proposals = [proposal, second];
      client.emit(decodeAppBackendEvent({ seq: 1, occurredAt: '2026-10-29T13:19:32.126Z', type: 'conversation.shareChanged', agentId: agent.id, payload: { active: true, handle: proposal.handle, connectedGuests: 1, availability: 'ready', proposals, authors: [] } }));
      await flushPromises();
      expect(control.mock.calls).toHaveLength(readsBeforeUpdate);
      const drawer = wrapper.get('.chat-composer-shelf [aria-label="Suggestions"]');
      expect(drawer.text()).toContain(proposal.text); expect(drawer.text()).toContain('Alex');
      expect(drawer.findAll('svg.tabler-icon-share')).toHaveLength(2);
      expect(drawer.findAll('svg')[0]!.classes()).toContain('tabler-icon-share');
      expect(drawer.text()).not.toContain(proposal.discriminator);
      await drawer.get('button[aria-label="Move suggestion to composer"]').trigger('click'); await flushPromises();
      expect(wrapper.emitted('update:composerState')?.at(-1)?.[0]).toMatchObject({ agentId: agent.id, state: { text: `Existing draft\n\n${proposal.text}` } });
      expect(control).toHaveBeenCalledWith(expect.objectContaining({ action: 'dismiss', handle: proposal.handle, proposalId: proposal.id }));
      await wrapper.get('.chat-composer-shelf button[aria-label="Delete suggestion"]').trigger('click'); await flushPromises();
      expect(control).toHaveBeenCalledWith(expect.objectContaining({ action: 'dismiss', handle: proposal.handle, proposalId: second.id }));
      expect(wrapper.find('[aria-label="Suggestions"]').exists()).toBe(false);
      expect(control.mock.calls.some(([input]) => input.action === 'send')).toBe(false);
    } finally { wrapper.unmount(); }
  });
  // The real shared pane must keep suggestions in the drawer, expose only withdrawal,
  // and retain a suggestion when deletion cannot be confirmed.
  it('lets collaborators delete their pending suggestions from the composer drawer', async () => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    const proposal = { id: '11111111-1111-4111-8111-111111111111', handle: 'a'.repeat(32), identity: 'guest', name: 'Alex', discriminator: '1234abcd', text: 'Please inspect the retry path', status: 'pending' as const, createdAt: 'now' };
    agent.sharedConversation = { joinId: 'shared-join' };
    const view: GuestJoinView = { id: 'shared-join', name: 'My display name', title: 'Owner title', status: 'ready', participant: { identity: 'guest', name: 'My display name', discriminator: '1234abcd' }, target: null, frame: null, proposalState: { proposals: [proposal], authors: [] } };
    const control = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await wrapper.setProps({ guestState: { entries: [], view: { ...view, status: 'connecting' } }, guestControl: control }); await flushPromises();
      expect(wrapper.get('.shared-conversation-pane [aria-label="Loading conversation"]').attributes('role')).toBe('status');
      expect(wrapper.find('.shared-conversation-pane [contenteditable="true"]').exists()).toBe(false);
      await wrapper.setProps({ guestState: { entries: [], view } }); await flushPromises();
      expect(wrapper.find('.shared-conversation-pane [aria-label="Loading conversation"]').exists()).toBe(false);
      const header = wrapper.get('.agent-header');
      expect(header.get('[role="status"]').text()).toContain('Connected');
      expect(header.text()).not.toContain(view.name);
      expect(wrapper.find('.shared-conversation-pane__status').exists()).toBe(false);
      const drawer = wrapper.get('.chat-composer-shelf [aria-label="Suggestions"]');
      expect(drawer.get('svg.tabler-icon-share').attributes('aria-hidden')).toBe('true');
      expect(drawer.text()).toContain(proposal.text);
      expect(drawer.find('[aria-label="Move suggestion to composer"]').exists()).toBe(false);
      await drawer.get('button[aria-label="Delete suggestion"]').trigger('click'); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'withdraw', id: view.id, proposalId: proposal.id });
      expect(wrapper.get('[role="alert"]').text()).toContain('Could not delete');
      expect(drawer.text()).toContain(proposal.text);
      await drawer.get('button[aria-label="Delete suggestion"]').trigger('click'); await flushPromises();
      await wrapper.setProps({ guestState: { entries: [], view: { ...view, proposalState: { proposals: [], authors: [] } } } });
      expect(wrapper.find('[aria-label="Suggestions"]').exists()).toBe(false);
      await header.get('button[aria-label="Leave"]').trigger('click'); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'leave', id: view.id });
    } finally { wrapper.unmount(); }
  });
  it.each(['queue', 'steer'] as const)('uses the guest’s %s preference and drops that choice for read-only suggestions', async preference => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    snapshot.general.followUpBehavior = preference;
    agent.sharedConversation = { joinId: 'shared-join' };
    const view: GuestJoinView = { id: 'shared-join', name: 'Guest', title: 'Owner chat', status: 'ready', participant: null, target: null,
      frame: { type: 'claude.conversationSnapshotChanged', backend: 'claude', agentId: 'owner', backendSessionId: 'owner-session', seq: 1, occurredAt: 'now', payload: { revision: 1, snapshot: { agentId: 'owner', sessionId: 'owner-session', activeTurnId: 'turn', turnIds: ['turn'], turns: [], messages: [], answeredClientRequestIds: [], busy: true, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null } } },
      proposalState: { writeAccess: true, proposals: [], authors: [] } };
    const control = vi.fn().mockResolvedValue(true);
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    const enterText = async (text: string) => {
      const editor = wrapper.get('.shared-conversation-pane [role="textbox"][contenteditable]');
      editor.element.textContent = text; await editor.trigger('input'); await flushPromises();
    };
    try {
      await wrapper.setProps({ guestState: { entries: [], view }, guestControl: control }); await flushPromises();
      expect(wrapper.get(`button[aria-label="${preference === 'steer' ? 'Steer' : 'Queue'} prompt"]`).attributes('disabled')).toBeDefined();
      await enterText('My follow-up');
      await wrapper.get(`button[aria-label="${preference === 'steer' ? 'Steer' : 'Queue'} prompt"]`).trigger('click'); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'propose', id: view.id, text: 'My follow-up', proposalId: expect.any(String), followUpBehavior: preference });
      await enterText('Alternate follow-up');
      await wrapper.get('.shared-conversation-pane [role="textbox"][contenteditable]').trigger('keydown', { key: 'Enter', metaKey: true }); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'propose', id: view.id, text: 'Alternate follow-up', proposalId: expect.any(String), followUpBehavior: preference === 'queue' ? 'steer' : 'queue' });
      await wrapper.setProps({ guestState: { entries: [], view: { ...view, proposalState: { writeAccess: false, proposals: [], authors: [] } } } }); await flushPromises();
      await enterText('Review this suggestion');
      await wrapper.get('button[aria-label="Send prompt"]').trigger('click'); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'propose', id: view.id, text: 'Review this suggestion', proposalId: expect.any(String) });
    } finally { wrapper.unmount(); }
  });
  it('shows connected names and synchronizes individual owner-controlled write switches', async () => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'owner' };
    const guests = [{ identity: 'one', name: 'Alex', discriminator: '11111111', writeAccess: false }, { identity: 'two', name: 'Alex', discriminator: '22222222', writeAccess: false }];
    const state = { active: true, handle: 'a'.repeat(32), connectedGuests: 2, availability: 'ready' as const, guests };
    const client = createClientApiMock();
    const control = vi.fn(async (input: ConversationShareControl) => {
      if (input.action === 'access') guests.find(guest => guest.identity === input.identity)!.writeAccess = input.writeAccess;
      return { state: structuredClone(state) };
    });
    setElectronTestClient({ conversationShareControl: control, onEvent: client.api.onEvent });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises(); await openShareDialog(wrapper);
      const switches = () => wrapper.findAll('[role="switch"]');
      expect(switches()).toHaveLength(2);
      expect(switches().map(item => item.attributes('aria-checked'))).toEqual(['false', 'false']);
      expect(wrapper.get('.conversation-share-guests').text()).toContain('Alex');
      expect(wrapper.get('.conversation-share-guests').text()).toContain('11111111');
      await switches()[0]!.setValue(true); await flushPromises();
      expect(control).toHaveBeenLastCalledWith({ action: 'access', target: expect.objectContaining({ agentId: agent.id }), handle: state.handle, identity: 'one', writeAccess: true });
      expect(switches().map(item => item.attributes('aria-checked'))).toEqual(['true', 'false']);
      client.emit(decodeAppBackendEvent({ seq: 1, occurredAt: 'now', type: 'conversation.shareChanged', agentId: agent.id, payload: { ...state, guests: [{ ...guests[0]!, writeAccess: false }] , connectedGuests: 1 } }));
      await flushPromises(); expect(switches()).toHaveLength(1); expect(switches()[0]!.attributes('aria-checked')).toBe('false');
    } finally { wrapper.unmount(); }
  });
  it('uses one dialog and the same backend link from the header and context menu', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!; agent.backend = 'antigravity'; agent.backendSession = { kind: 'antigravity', sessionId: 'share-fixture' };
    const inactive = { active: false, handle: null, connectedGuests: null, availability: 'transportPending' as const };
    const active = { ...inactive, active: true, handle: 'a'.repeat(32) };
    let shared = false;
    const link = 'synthetic-bearer-redacted';
    const conversationShareControl = vi.fn(async (input: ConversationShareControl) => {
      structuredClone(input); // Native IPC must be able to copy the request, including its target.
      if (input.action === 'create') shared = true;
      if (input.action === 'revoke') shared = false;
      return { state: shared ? active : inactive, ...(['copy', 'create'].includes(input.action) ? { link } : {}) };
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    setElectronTestClient({ conversationShareControl });
    const wrapper = mountShell({ snapshot, realAgentSidebar: true, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises();
      const more = wrapper.get('button[aria-label="Agent actions"]');
      expect(more.text()).toBe('');
      expect(more.find('svg').exists()).toBe(true);
      await openShareDialog(wrapper);
      expect(wrapper.text()).toContain('Anyone with this link');
      expect(wrapper.text()).toContain('full available history');
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status']);
      expect(wrapper.findAll('.app-dialog__footer button').map(button => button.text())).toStrictEqual(['Close', 'Share']);
      const button = (text: string) => wrapper.findAll('.app-dialog__footer button').find(button => button.text() === text)!;
      await button('Share').trigger('click'); await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith(link);
      expect(wrapper.findComponent({ name: 'ConversationShareDialog' }).exists()).toBe(false);
      expect(wrapper.text()).not.toContain(link);
      await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu', { clientX: 100, clientY: 100 });
      await clickPortaledMenuItem('Share with guests'); await flushPromises();
      expect(wrapper.findAll('.app-dialog__footer button').map(button => button.text())).toStrictEqual(['Close', 'Stop sharing', 'Copy link']);
      await button('Copy link').trigger('click'); await flushPromises();
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(wrapper.findComponent({ name: 'ConversationShareDialog' }).exists()).toBe(false);
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status', 'create', 'status', 'copy']);
      await openShareDialog(wrapper);
      await button('Stop sharing').trigger('click'); await flushPromises();
      expect(conversationShareControl.mock.calls.at(-1)![0]).toStrictEqual({ action: 'revoke', target: expect.objectContaining({ agentId: agent.id }), handle: active.handle });
      expect(wrapper.findComponent({ name: 'ConversationShareDialog' }).exists()).toBe(false);
    } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
  });
  it('recovers from status and clipboard errors without creating another grant', async () => {
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'fixture' };
    const state = { active: false, handle: null, connectedGuests: null, availability: 'transportPending' as const };
    const active = { ...state, active: true, handle: 'a'.repeat(32) };
    const conversationShareControl = vi.fn().mockRejectedValueOnce(new Error('storage-secret'))
      .mockResolvedValueOnce({ state }).mockResolvedValue({ state: active, link: 'synthetic-redacted' });
    const writeText = vi.fn().mockRejectedValueOnce(new Error('clipboard denied')).mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    setElectronTestClient({ conversationShareControl });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      const button = (text: string) => wrapper.findAll('.app-dialog__footer button').find(button => button.text() === text)!;
      await openShareDialog(wrapper);
      expect(wrapper.text()).not.toContain('storage-secret');
      await button('Try again').trigger('click'); await flushPromises();
      await button('Share').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('copying failed');
      expect(wrapper.findComponent({ name: 'ConversationShareDialog' }).exists()).toBe(true);
      await button('Copy link').trigger('click'); await flushPromises();
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status', 'status', 'create', 'copy']);
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(wrapper.findComponent({ name: 'ConversationShareDialog' }).exists()).toBe(false);
    } finally {
      wrapper.unmount();
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
  it.each([
    ['Conversation is unavailable for sharing.', 'conversation has changed'],
    ['Share storage is unavailable. Check local storage and try again.', 'local share data'],
  ])('explains a failed status check without leaving a disabled create action: %s', async (message, expected) => {
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'fixture' };
    setElectronTestClient({ conversationShareControl: vi.fn().mockRejectedValue(new Error(message)) });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await openShareDialog(wrapper);
      expect(wrapper.text()).toContain(expected);
      const retry = wrapper.findAll('button').find(button => button.text() === 'Try again')!;
      expect(retry.attributes('disabled')).toBeUndefined();
      expect(wrapper.findAll('.app-dialog__footer button').some(button => button.text() === 'Share')).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('keeps relay diagnostics internal while preserving active link controls', async () => {
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'fixture' };
    let availability: 'capacity' | 'upgradeRequired' | 'unavailable' = 'capacity';
    let active = true;
    setElectronTestClient({ conversationShareControl: async () => ({ state: { active, handle: active ? 'a'.repeat(32) : null, connectedGuests: null, availability } }) });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await openShareDialog(wrapper);
      expect(wrapper.text()).toContain('Sharing is temporarily unavailable');
      expect(wrapper.text()).not.toContain('relay');
      expect(wrapper.findAll('button').some(button => button.text() === 'Copy link')).toBe(true);
      wrapper.findComponent({ name: 'ConversationShareDialog' }).vm.$emit('close'); await flushPromises();
      availability = 'upgradeRequired';
      await openShareDialog(wrapper);
      expect(wrapper.text()).toContain('Sharing is temporarily unavailable');
      expect(wrapper.text()).not.toContain('relay upgrade');
      wrapper.findComponent({ name: 'ConversationShareDialog' }).vm.$emit('close'); await flushPromises();
      active = false; availability = 'unavailable';
      await openShareDialog(wrapper);
      expect(wrapper.text()).not.toContain('saved link will work');
    } finally { wrapper.unmount(); }
  });
  it('hides sharing for remote-host conversations', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'remote' };
    snapshot.agents[0]!.remoteConnectionId = 'remote';
    const wrapper = mountShell({ snapshot, realAgentSidebar: true, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises(); expect(wrapper.find('button[aria-label="Share"]').exists()).toBe(false);
      await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu', { clientX: 100, clientY: 100 });
      expect(document.body.textContent).not.toContain('Share with guests');
    } finally { wrapper.unmount(); }
  });
});
