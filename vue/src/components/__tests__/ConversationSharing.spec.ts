import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { ConversationShareControl } from '@workspace/core/conversation-sharing';
import { setElectronTestClient } from '../../test/client';
import { mountShell, clickPortaledMenuItem } from './app-shell-test-harness';

// Mounted shell catches entry-point routing, duplicate grants, missing disclosure,
// stale async results and accidental credential display. Provider UI is a boundary fake.
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('owner Share workflow', () => {
  it('requires an owner decision for a named guest proposal in the normal conversation', async () => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'owner' };
    const proposal = { id: '11111111-1111-4111-8111-111111111111', handle: 'a'.repeat(32), identity: 'guest-identity', name: 'Alex', discriminator: '1234abcd', text: 'Please inspect the retry path', status: 'pending' as const, createdAt: 'now' };
    const control = vi.fn(async (input: ConversationShareControl) => ({ state: { active: true, handle: proposal.handle, connectedGuests: 1, availability: 'ready' as const, proposals: input.action === 'send' || input.action === 'dismiss' ? [] : [proposal] } }));
    setElectronTestClient({ conversationShareControl: control });
    const wrapper = mountShell({ snapshot, realConversationPane: true, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises();
      expect(wrapper.text()).toContain(proposal.text); expect(wrapper.text()).toContain('Alex');
      await wrapper.findAll('button').find(button => button.text() === 'Dismiss')!.trigger('click'); await flushPromises();
      expect(control).toHaveBeenCalledWith(expect.objectContaining({ action: 'dismiss', handle: proposal.handle, proposalId: proposal.id }));
      expect(wrapper.text()).not.toContain(proposal.text);
    } finally { wrapper.unmount(); }
  });
  it.each(['claude', 'antigravity'] as const)('does not offer Share when the %s backend is unqualified', async backend => {
    const snapshot = createInitialSnapshot(); const agent = snapshot.agents[0]!;
    agent.backend = backend; agent.backendSession = backend === 'claude' ? { kind: 'claude', sessionId: 'unqualified', transport: 'stdio' } : { kind: 'antigravity', sessionId: 'unqualified' };
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try { await flushPromises(); expect(wrapper.find('button[aria-label="Share"]').exists()).toBe(false); } finally { wrapper.unmount(); }
  });
  it('uses one dialog and the same backend link from the header and context menu', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!; agent.backendSession = { kind: 'codex', threadId: 'share-fixture' };
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
      const share = wrapper.get('button[aria-label="Share"]');
      expect(share.text()).toBe('');
      expect(share.find('svg').exists()).toBe(true);
      await share.trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('Anyone with this link');
      expect(wrapper.text()).toContain('full available history');
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status']);
      expect(wrapper.findAll('.app-dialog__footer button').map(button => button.text())).toStrictEqual(['Cancel', 'Create and copy link']);
      const button = (text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
      await button('Create and copy link').trigger('click'); await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith(link);
      expect(wrapper.findAll('.app-dialog__footer button').map(button => button.text())).toStrictEqual(['Stop sharing', 'Copy link']);
      expect(wrapper.text()).not.toContain(link);
      wrapper.findComponent({ name: 'ConversationShareDialog' }).vm.$emit('close'); await flushPromises();
      await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu', { clientX: 100, clientY: 100 });
      await clickPortaledMenuItem('Share with guests'); await flushPromises();
      await button('Copy link').trigger('click'); await flushPromises();
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status', 'create', 'status', 'copy']);
      await button('Stop sharing').trigger('click'); await flushPromises();
      expect(conversationShareControl.mock.calls.at(-1)![0]).toStrictEqual({ action: 'revoke', target: expect.objectContaining({ agentId: agent.id }), handle: active.handle });
      expect(button('Create and copy link').exists()).toBe(true);
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
      const button = (text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).not.toContain('storage-secret');
      await button('Try again').trigger('click'); await flushPromises();
      await button('Create and copy link').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('copying failed');
      await button('Copy link').trigger('click'); await flushPromises();
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status', 'status', 'create', 'copy']);
      expect(writeText).toHaveBeenCalledTimes(2);
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
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain(expected);
      const retry = wrapper.findAll('button').find(button => button.text() === 'Try again')!;
      expect(retry.attributes('disabled')).toBeUndefined();
      expect(wrapper.findAll('button').some(button => button.text() === 'Create and copy link')).toBe(false);
    } finally { wrapper.unmount(); }
  });
  it('keeps relay diagnostics internal while preserving active link controls', async () => {
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'fixture' };
    let availability: 'capacity' | 'upgradeRequired' | 'unavailable' = 'capacity';
    let active = true;
    setElectronTestClient({ conversationShareControl: async () => ({ state: { active, handle: active ? 'a'.repeat(32) : null, connectedGuests: null, availability } }) });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('Sharing is temporarily unavailable');
      expect(wrapper.text()).not.toContain('relay');
      expect(wrapper.findAll('button').some(button => button.text() === 'Copy link')).toBe(true);
      wrapper.findComponent({ name: 'ConversationShareDialog' }).vm.$emit('close'); await flushPromises();
      availability = 'upgradeRequired';
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('Sharing is temporarily unavailable');
      expect(wrapper.text()).not.toContain('relay upgrade');
      wrapper.findComponent({ name: 'ConversationShareDialog' }).vm.$emit('close'); await flushPromises();
      active = false; availability = 'unavailable';
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).not.toContain('saved link will work');
    } finally { wrapper.unmount(); }
  });
  it('hides sharing for remote-host conversations', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'remote' };
    snapshot.teams[0]!.remoteConnectionId = 'remote';
    const wrapper = mountShell({ snapshot, realAgentSidebar: true, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await flushPromises(); expect(wrapper.find('button[aria-label="Share"]').exists()).toBe(false);
      await wrapper.findAll('.agent-sidebar__agent')[0]!.trigger('contextmenu', { clientX: 100, clientY: 100 });
      expect(document.body.textContent).not.toContain('Share with guests');
    } finally { wrapper.unmount(); }
  });
});
