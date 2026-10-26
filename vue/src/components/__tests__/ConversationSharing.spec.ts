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
  it('uses one dialog and the same backend link from the header and context menu', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!; agent.backendSession = { kind: 'codex', threadId: 'share-fixture' };
    const inactive = { active: false, handle: null, connectedGuests: null, availability: 'transportPending' as const };
    const active = { ...inactive, active: true, handle: 'a'.repeat(32) };
    let shared = false;
    const link = 'synthetic-bearer-redacted';
    const conversationShareControl = vi.fn(async (input: ConversationShareControl) => {
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
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('Anyone with this link');
      expect(wrapper.text()).toContain('full available history');
      expect(conversationShareControl.mock.calls.map(([input]) => input.action)).toStrictEqual(['status']);
      const button = (text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
      await button('Create and copy link').trigger('click'); await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith(link);
      expect(wrapper.text()).not.toContain(link);
      await button('Done').trigger('click');
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
  it('shows relay capacity and upgrade failures while preserving the active link controls', async () => {
    const snapshot = createInitialSnapshot(); snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'fixture' };
    let availability: 'capacity' | 'upgradeRequired' | 'unavailable' = 'capacity';
    let active = true;
    setElectronTestClient({ conversationShareControl: async () => ({ state: { active, handle: active ? 'a'.repeat(32) : null, connectedGuests: null, availability } }) });
    const wrapper = mountShell({ snapshot, stubRightWorkspacePanel: true, stubTeamRail: true });
    try {
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('relay is full');
      expect(wrapper.findAll('button').some(button => button.text() === 'Copy link')).toBe(true);
      await wrapper.findAll('button').find(button => button.text() === 'Done')!.trigger('click');
      availability = 'upgradeRequired';
      await wrapper.get('button[aria-label="Share"]').trigger('click'); await flushPromises();
      expect(wrapper.text()).toContain('relay upgrade');
      await wrapper.findAll('button').find(button => button.text() === 'Done')!.trigger('click');
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
