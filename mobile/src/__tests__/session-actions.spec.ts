import { describe, expect, it, vi } from 'vitest';
import type { CompanionSession } from '../companion-port';
import { createSessionActions } from '../session-actions';

const target = { hostId: 'laptop', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null };
function fixture(preview: { isLinkedWorktree: boolean } = { isLinkedWorktree: false }) {
  const session = { interrupt: vi.fn(async () => {}), restartSession: vi.fn(async () => {}), closeSession: vi.fn(async () => {}),
    previewCloseSession: vi.fn(async () => ({ target, branch: null, upstream: null, hasChanges: false, ...preview })) };
  const env = { session: session as unknown as CompanionSession, selection: 1, refreshed: true };
  const reopen = vi.fn(async () => {});
  const actions = createSessionActions({ session: () => env.session, connected: () => true, conversationReady: () => true, agentId: () => 'agent', selection: () => env.selection,
    currentTarget: () => target, refreshWorkspace: async () => env.refreshed, reopen });
  return { session, env, reopen, actions };
}

describe('session actions', () => {
  it('interrupts a run and refreshes the workspace without reopening the chat', async () => {
    const f = fixture();
    await f.actions.interrupt();
    expect(f.session.interrupt).toHaveBeenCalledWith('agent');
    expect(f.reopen).not.toHaveBeenCalled(); expect(f.actions.failed.value).toBe(false); expect(f.actions.action.value).toBeNull();
  });

  it('closes a chat that has no worktree right after previewing it, then leaves the chat', async () => {
    const f = fixture({ isLinkedWorktree: false });
    await f.actions.requestClose();
    expect(f.session.closeSession).toHaveBeenCalledOnce();
    expect(f.reopen).toHaveBeenCalledExactlyOnceWith('');
  });

  it('asks before closing a chat with a worktree', async () => {
    const f = fixture({ isLinkedWorktree: true });
    await f.actions.requestClose();
    expect(f.session.closeSession).not.toHaveBeenCalled();
    expect(f.actions.closePreview.value?.isLinkedWorktree).toBe(true);
  });

  it('drops the outcome when the person moved to another chat while the laptop worked', async () => {
    const f = fixture();
    f.session.restartSession.mockImplementationOnce(async () => { f.env.selection = 2; throw new Error('late failure'); });
    await f.actions.restart();
    expect(f.actions.failed.value).toBe(false); expect(f.reopen).not.toHaveBeenCalled();
  });
});
