import { PromptRejectedError } from '../companion-port';
import { describe, expect, it, vi } from 'vitest';
import { createCompanionState } from '../companion-state';
import { createDemoConnector } from '../demo-connector';
import type { CompanionConversation, CompanionWorkspace } from '../companion-port';

describe('companion state', () => {
  it('says why the laptop could not be reached, and forgets it once connected', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const connector = createDemoConnector(); const original = connector.connect;
    let failure: Error | null = null; let lost!: (reason?: string) => void;
    connector.connect = async id => {
      if (failure) throw failure;
      return { ...await original(id), onDisconnect(listener: (reason?: string) => void) { lost = listener; return () => {}; } };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop');
      expect(state.errorDetail.value).toBe('');
      lost('heartbeat-timeout');
      expect(state.errorDetail.value).toBe('heartbeat-timeout');
      failure = Object.assign(new Error('no valid addresses'), { name: 'DialError' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.errorDetail.value).toBe('DialError: no valid addresses');
      failure = null;
      await vi.advanceTimersByTimeAsync(4000);
      expect(state.status.value).toBe('connected');
      expect(state.errorDetail.value).toBe('');
    } finally { state.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it('restarts the retry schedule when the app returns to the foreground', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const connector = createDemoConnector(); const original = connector.connect;
    let lost!: () => void; let fail = false;
    const connect = vi.fn(async (id: string) => { if (fail) throw new Error('offline'); const session = await original(id); return { ...session, onDisconnect(listener: () => void) { lost = listener; return () => {}; } }; });
    connector.connect = connect;
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); fail = true; lost();
      for (const delay of [1000, 2000, 4000]) await vi.advanceTimersByTimeAsync(delay);
      const attempts = connect.mock.calls.length;
      await state.setActive(false); await state.setActive(true); await state.reconnect();
      expect(connect).toHaveBeenCalledTimes(attempts + 1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(connect).toHaveBeenCalledTimes(attempts + 2);
    } finally { state.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it('backs off repeated disconnects during history loading until a conversation actually synchronizes', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const connector = createDemoConnector(); const original = connector.connect;
    let lost!: () => void; let dropOnLoad = false;
    const connect = vi.fn(async (id: string) => {
      const session = await original(id);
      return { ...session, onDisconnect(listener: () => void) { lost = listener; return () => {}; },
        loadConversation: async (agentId: string) => {
          if (dropOnLoad) { lost(); throw new Error('History stream closed'); }
          return session.loadConversation(agentId);
        } };
    });
    connector.connect = connect;
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const retained = state.conversation.value;
      dropOnLoad = true; lost();
      for (const [attempt, delay] of [1000, 2000, 4000].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(connect).toHaveBeenCalledTimes(attempt + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(connect).toHaveBeenCalledTimes(attempt + 2);
        expect(state.canSend.value).toBe(false);
        expect(state.conversation.value).toStrictEqual(retained);
      }
      dropOnLoad = false;
      await vi.advanceTimersByTimeAsync(8000);
      expect(state.canSend.value).toBe(true);
      lost();
      await vi.advanceTimersByTimeAsync(1000);
      expect(connect).toHaveBeenCalledTimes(6);
    } finally { state.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it.each(['replacement', 'reset', 'location'] as const)('clears the selected transcript and awaits the new identity after a %s update', async change => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let update!: (workspace: CompanionWorkspace, frame: CompanionConversation | null) => void;
    let workspace!: CompanionWorkspace;
    let finish!: (frame: CompanionConversation | null) => void;
    let delayed = false;
    connector.connect = async id => {
      const session = await connect(id);
      const initial = await session.getWorkspace();
      workspace = { ...initial, agents: initial.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex', threadId: agent.id } })) };
      return { ...session, getWorkspace: async () => workspace,
        onUpdate: listener => { update = listener; return () => {}; },
        loadConversation: async agentId => delayed ? new Promise(resolve => { finish = resolve; }) : session.loadConversation(agentId) };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const old = state.conversation.value!;
      delayed = true;
      workspace = { ...workspace, teams: workspace.teams.map(team => change === 'location' ? { ...team, remoteConnectionId: 'new-host' } : team),
        agents: workspace.agents.map(agent => agent.id !== 'demo-agent' || change === 'location' ? agent : { ...agent, backendSession: change === 'reset' ? undefined : { kind: 'codex', threadId: 'replacement' } }) };
      update(workspace, null);
      expect(state.conversation.value).toBeNull();
      expect(state.canSend.value).toBe(false);
      update(workspace, old);
      expect(state.conversationReady.value).toBe(false);
      const next = change === 'reset' ? null : { ...old, threadId: change === 'replacement' ? 'replacement' : old.threadId } as CompanionConversation;
      finish(next);
      await vi.waitFor(() => expect(state.conversationReady.value).toBe(true));
      expect(state.conversation.value).toStrictEqual(next);
      expect(state.canSend.value).toBe(true);
      if (change === 'replacement') { update(workspace, old); expect(state.conversation.value).toStrictEqual(next); }
    } finally { state.dispose(); }
  });

  it('retires optimistic permissions after acknowledgment and follows later laptop policy', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let update!: (workspace: CompanionWorkspace, frame: CompanionConversation | null) => void;
    let workspace!: CompanionWorkspace;
    let accept!: () => void;
    const setApprovalPreset = vi.fn(() => new Promise<void>(resolve => { accept = resolve; }));
    connector.connect = async id => {
      const session = await connect(id); workspace = await session.getWorkspace();
      return { ...session, getWorkspace: async () => workspace, setApprovalPreset, onUpdate: listener => { update = listener; return () => {}; } };
    };
    const state = createCompanionState(connector);
    const policy = (preset: string) => ({ ...workspace, agents: workspace.agents.map(agent => ({ ...agent, backendDefaults: { kind: 'codex' as const, approvalPreset: preset as 'ask-for-approval' | 'full-access' } })) });
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const changing = state.setApprovalPreset('ask-for-approval');
      expect(state.permissions.value?.approvalPreset).toBe('ask-for-approval');
      workspace = policy('ask-for-approval'); update(workspace, null); accept(); await changing;
      workspace = policy('full-access'); update(workspace, null);
      expect(state.permissions.value?.approvalPreset).toBe('full-access');
    } finally { state.dispose(); }
  });

  it('preserves a rejected draft and permits an explicit new send immediately', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const send = vi.fn().mockRejectedValueOnce(new PromptRejectedError()).mockResolvedValue(undefined);
    connector.connect = async id => ({ ...await connect(id), sendPrompt: send });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.updateDraft({ text: 'Try me', selectionStart: 6, selectionEnd: 6 });
      expect(await state.submit('Try me')).toBe('rejected');
      expect(state.canSend.value).toBe(true); expect(state.draft.value.text).toBe('Try me');
      expect(await state.submit('Try me')).toBe('accepted');
      expect(send.mock.calls[0]![2]).not.toBe(send.mock.calls[1]![2]);
    } finally { state.dispose(); }
  });
  it('keeps an unresolved warning and draft but permits a deliberate new send after reconciliation', async () => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const connect = connector.connect;
    const send = vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(undefined);
    connector.connect = async id => ({ ...await connect(id), sendPrompt: send, commandStatus: async () => 'unresolved' });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await state.submit('Check first');
      await vi.advanceTimersByTimeAsync(5000);
      expect(state.canSend.value).toBe(true); expect(state.deliveryUnknown.value).toBe(true);
      expect(state.error.value).toBe('mobile.errors.deliveryUnknown'); expect(state.draft.value.text).toBe('Check first');
      expect(send).toHaveBeenCalledOnce();
      await state.submit('My deliberate next prompt'); expect(send).toHaveBeenCalledTimes(2);
    } finally { state.dispose(); vi.useRealTimers(); }
  });
  it.each(['accepted', 'rejected'] as const)('reconciles slow admission to %s without reconnecting or replaying', async (outcome) => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const connect = connector.connect;
    const send = vi.fn().mockRejectedValue(new Error('Request timed out'));
    const commandStatus = vi.fn().mockResolvedValueOnce('pending').mockResolvedValue(outcome);
    connector.connect = async id => ({ ...await connect(id), sendPrompt: send, commandStatus });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.updateDraft({ text: 'Keep this', selectionStart: 9, selectionEnd: 9 });
      await state.submit('Keep this');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.canSend.value).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(state.canSend.value).toBe(true);
      expect(state.deliveryUnknown.value).toBe(false);
      expect(state.draft.value.text).toBe(outcome === 'accepted' ? '' : 'Keep this');
      expect(send).toHaveBeenCalledOnce();
      state.dispose(); const checks = commandStatus.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000); expect(commandStatus).toHaveBeenCalledTimes(checks);
    } finally { state.dispose(); vi.useRealTimers(); }
  });

  it('shows a live cached conversation immediately when returning, without a loading or empty state', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    connector.connect = async (id) => {
      const session = await original(id);
      const frames = new Map<string, Awaited<ReturnType<typeof session.loadConversation>>>();
      return { ...session, cachedConversation: (agentId) => frames.get(agentId), loadConversation: async (agentId) => {
        const frame = frames.get(agentId) ?? await session.loadConversation(agentId); frames.set(agentId, frame); return frame;
      } };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const first = state.conversation.value;
      await state.selectAgent('demo-reviewer');
      const returning = state.selectAgent('demo-agent');
      expect(state.conversation.value).toBe(first);
      expect(state.loading.value).toBe(false); expect(state.conversationReady.value).toBe(true);
      await returning;
    } finally { state.dispose(); }
  });
  it.each([false, true])('waits for worktree confirmation, then closes only the previewed session (delete: %s)', async (deleting) => {
    const connector = createDemoConnector(); const original = connector.connect;
    const target = { hostId: 'laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null };
    const preview = { target, isLinkedWorktree: true, branch: 'feature', upstream: 'origin/feature', hasChanges: true };
    const closeSession = vi.fn();
    let finishClose!: () => void;
    const closing = new Promise<void>(resolve => { finishClose = resolve; });
    connector.connect = async (id) => {
      const session = await original(id); let workspace = await session.getWorkspace();
      closeSession.mockImplementation(async () => { await closing; workspace = { ...workspace, agents: workspace.agents.filter((agent) => agent.id !== target.agentId) }; });
      return { ...session, getWorkspace: async () => workspace, previewCloseSession: async () => preview, closeSession };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await state.requestCloseSession();
      expect(state.closePreview.value).toStrictEqual(preview);
      expect(closeSession).not.toHaveBeenCalled();
      await state.confirmCloseSession('demo-agent', true, false, false);
      expect(closeSession).not.toHaveBeenCalled(); // Dirty work needs explicit discard consent.
      const pending = state.confirmCloseSession('demo-agent', deleting, deleting, deleting);
      expect(state.sessionAction.value).toBe('close');
      state.cancelCloseSession();
      expect(state.closePreview.value).toStrictEqual(preview);
      expect(state.agentId.value).toBe('demo-agent');
      finishClose(); await pending;
      expect(state.sessionAction.value).toBeNull();
      expect(closeSession).toHaveBeenCalledExactlyOnceWith(target, deleting ? { deleteWorktree: true, deleteRemoteBranch: true, discardChanges: true, confirmed: true } : undefined);
      expect(state.closePreview.value).toBeNull();
      expect(state.agentId.value).toBe('demo-reviewer');
      expect(state.conversation.value?.agentId).toBe('demo-reviewer');
    } finally { state.dispose(); }
  });
  it('does not expose inherited base tracking as a remotely deletable branch from an older host', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const closeSession = vi.fn(async () => {});
    const preview = { target: { hostId: 'laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, isLinkedWorktree: true, branch: 'feature/new', upstream: 'origin/main', hasChanges: false };
    connector.connect = async id => ({ ...await original(id), previewCloseSession: async () => preview, closeSession });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await state.requestCloseSession();
      expect(state.closePreview.value).toStrictEqual({ ...preview, upstream: null });
      await state.confirmCloseSession('demo-agent', true, true);
      expect(closeSession).toHaveBeenCalledExactlyOnceWith(preview.target, { deleteWorktree: true, deleteRemoteBranch: false, discardChanges: false, confirmed: true });
    } finally { state.dispose(); }
  });

  it('keeps a refused close open and rejects stale confirmation after changing conversations', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const closeSession = vi.fn(async () => { throw new Error('Worktree changed'); });
    const preview = { target: { hostId: 'laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, isLinkedWorktree: true, branch: 'feature', upstream: null, hasChanges: false };
    connector.connect = async (id) => ({ ...await original(id), closeSession, previewCloseSession: async () => preview });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await state.requestCloseSession(); await state.confirmCloseSession('demo-agent', true);
      expect(state.sessionActionFailed.value).toBe(true);
      expect(state.closePreview.value).toStrictEqual(preview);
      expect(state.agentId.value).toBe('demo-agent');
      await state.selectAgent('demo-reviewer');
      await state.confirmCloseSession('demo-agent', true);
      expect(closeSession).toHaveBeenCalledTimes(1);
      expect(state.closePreview.value).toBeNull();
      expect(state.sessionActionFailed.value).toBe(false);
    } finally { state.dispose(); }
  });
  it('retries transport loss with receipt reconciliation and stops retrying on manual disconnect', async () => {
    vi.useFakeTimers();
    const connector = createDemoConnector(); const original = connector.connect;
    let lost!: () => void;
    const send = vi.fn().mockRejectedValue(new Error('Receipt lost'));
    const commandStatus = vi.fn(async () => 'accepted' as const);
    const connect = vi.fn(async (id: string) => ({ ...await original(id), sendPrompt: send, commandStatus,
      onDisconnect(listener: () => void) { lost = listener; return () => {}; } }));
    connector.connect = connect;
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.updateDraft({ text: 'Send once', selectionStart: 9, selectionEnd: 9 }); await state.submit('Send once');
      lost(); expect(state.canSend.value).toBe(false);
      connect.mockRejectedValueOnce(new Error('Relay restarting'));
      await vi.advanceTimersByTimeAsync(1200);
      expect(state.status.value).toBe('error');
      await vi.advanceTimersByTimeAsync(2400);
      expect(state.status.value).toBe('connected'); expect(commandStatus).toHaveBeenCalledOnce();
      expect(state.deliveryUnknown.value).toBe(false); expect(state.draft.value.text).toBe(''); expect(send).toHaveBeenCalledOnce();
      lost(); state.disconnect(); const count = connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000); expect(connect).toHaveBeenCalledTimes(count);
    } finally { state.dispose(); vi.useRealTimers(); }
  });
  it('retains the loaded transcript when reconnect hydration fails, then recovers without leaking it to another agent', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const initial = await connect('demo-laptop');
    const loadConversation = vi.fn(initial.loadConversation);
    connector.connect = async (id) => ({ ...await connect(id), loadConversation });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const original = state.conversation.value;
      expect(original?.payload.snapshot.messages.length).toBeGreaterThan(0);
      loadConversation.mockRejectedValueOnce(new Error('History response interrupted'));
      state.disconnect(); await state.reconnect();
      expect(state.conversation.value).toEqual(original);
      expect(state.canSend.value).toBe(false);
      expect(state.error.value).toBe('mobile.errors.loadConversation');
      await state.selectAgent('demo-agent');
      expect(state.canSend.value).toBe(true);
      loadConversation.mockRejectedValueOnce(new Error('Unavailable'));
      await state.selectAgent('demo-reviewer');
      expect(state.conversation.value).toBeNull();
    } finally { state.dispose(); }
  });
  it('discards retained messages if the owning provider session changed while disconnected', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.disconnect();
      connector.connect = async (id) => {
        const session = await connect(id);
        const workspace = await session.getWorkspace();
        return { ...session, getWorkspace: async () => ({ ...workspace, agents: workspace.agents.map((agent) => ({ ...agent, backendSession: { kind: 'codex' as const, threadId: 'replacement' } })) }),
          loadConversation: async () => { throw new Error('Unavailable'); } };
      };
      await state.reconnect();
      expect(state.conversation.value).toBeNull();
      expect(state.canSend.value).toBe(false);
    } finally { state.dispose(); }
  });
  it('reconciles durable command receipts after restart and preserves a newer draft', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async (id) => ({ ...await connect(id), commandStatus: async () => 'accepted' });
    const key = '["demo-laptop","demo-agent"]';
    const store = { read: async () => ({ drafts: { [key]: { text: 'Newer draft', selectionStart: 11, selectionEnd: 11 } },
      uncertain: { [key]: true }, commandIds: { [key]: crypto.randomUUID() }, submittedTexts: { [key]: 'Already accepted' } }), write: vi.fn(async () => {}) };
    const state = createCompanionState(connector, store);
    await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
    expect(state.deliveryUnknown.value).toBe(false); expect(state.draft.value.text).toBe('Newer draft');
    expect(store.write).toHaveBeenCalled(); state.dispose();
  });
  it('restores drafts and uncertain delivery after process restart without resending', async () => {
    let saved: unknown = null;
    const store = { read: vi.fn(async () => saved), write: vi.fn(async (value: unknown) => { saved = structuredClone(value); }) };
    const connector = createDemoConnector();
    const connect = connector.connect;
    const send = vi.fn().mockRejectedValue(new Error('lost acknowledgement'));
    connector.connect = async (id) => ({ ...await connect(id), sendPrompt: send });
    const first = createCompanionState(connector, store);
    await first.connect('demo-laptop');
    await first.selectTeam('demo-team');
    await first.selectAgent('demo-agent');
    first.updateDraft({ text: 'Remember this', selectionStart: 12, selectionEnd: 12 });
    await first.submit('Remember this');
    first.dispose();
    const restored = createCompanionState(connector, store);
    await restored.connect('demo-laptop');
    await restored.selectTeam('demo-team');
    await restored.selectAgent('demo-agent');
    expect(restored.draft.value.text).toBe('Remember this');
    expect(restored.deliveryUnknown.value).toBe(true);
    await restored.submit('Remember this');
    expect(send).toHaveBeenCalledTimes(1);
    restored.dispose();
  });

  it('does not dispatch when protected storage fails before admission', async () => {
    const connector = createDemoConnector();
    const connect = connector.connect;
    const send = vi.fn();
    connector.connect = async (id) => ({ ...await connect(id), sendPrompt: send });
    const state = createCompanionState(connector, { read: async () => null, write: async () => { throw new Error('locked'); } });
    await state.connect('demo-laptop');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    state.updateDraft({ text: 'Keep locally', selectionStart: 12, selectionEnd: 12 });
    await state.submit('Keep locally');
    expect(send).not.toHaveBeenCalled();
    expect(state.draft.value.text).toBe('Keep locally');
    expect(state.error.value).toBe('mobile.errors.storage');
    state.dispose();
  });
  it('requires explicit demo pairing, scopes selection and drafts by laptop and agent, and revokes access', async () => {
    const connector = createDemoConnector();
    const state = createCompanionState(connector);
    await state.connect('unknown');
    expect(state.status.value).toBe('unpaired'); expect(state.error.value).toBe('mobile.errors.openLaptop');
    expect(state.workspace.value.agents).toStrictEqual([]);
    await state.connect('demo-laptop');
    expect(state.status.value).toBe('connected');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    state.updateDraft({ text: 'Dictated prompt', selectionStart: 15, selectionEnd: 15 });
    await state.selectAgent('other-agent');
    expect(state.agent.value?.id).toBe('demo-agent');
    expect(state.conversation.value?.agentId).toBe('demo-agent');
    await state.selectAgent('demo-agent');
    expect(state.draft.value.text).toBe('Dictated prompt');
    await state.revoke();
    expect(state.status.value).toBe('revoked');
    expect(state.conversation.value).toBeNull();
    await state.reconnect();
    expect(state.status.value).toBe('revoked');
    await state.connect('demo-laptop');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    expect(state.draft.value.text).toBe('Dictated prompt');
    state.dispose();
  });

  it('retains drafts offline and never replays an uncertain prompt on reconnect', async () => {
    const connector = createDemoConnector();
    const connect = connector.connect;
    const send = vi.fn().mockRejectedValue(new Error('connection lost'));
    connector.connect = async (id) => ({ ...await connect(id), sendPrompt: send });
    const state = createCompanionState(connector);
    await state.connect('demo-laptop');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    state.updateDraft({ text: 'Fix the bug', selectionStart: 11, selectionEnd: 11 });
    await state.submit('Fix the bug');
    expect(state.draft.value.text).toBe('Fix the bug');
    expect(state.deliveryUnknown.value).toBe(true);
    state.disconnect();
    await state.reconnect();
    expect(state.draft.value.text).toBe('Fix the bug');
    await state.submit('Fix the bug');
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.canSend.value).toBe(false);
    state.dispose();
  });

  it('submits once to the selected identity and clears only the accepted draft', async () => {
    const state = createCompanionState(createDemoConnector());
    await state.connect('demo-laptop');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    state.updateDraft({ text: 'Summarize', selectionStart: 9, selectionEnd: 9 });
    await Promise.all([state.submit('Summarize'), state.submit('Summarize')]);
    expect(state.draft.value.text).toBe('');
    expect(state.conversation.value?.payload.snapshot.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    state.dispose();
  });

  it('rejects wrong-agent frames and ignores stale conversation loads after navigation', async () => {
    const connector = createDemoConnector();
    const connect = connector.connect;
    let finishLoad!: () => void;
    let mismatch = false;
    connector.connect = async (id) => {
      const session = await connect(id);
      return { ...session, loadConversation: async (agentId) => {
        const frame = await session.loadConversation(agentId);
        if (!frame) throw new Error("Fixture conversation is required.");
        if (agentId === 'demo-agent') await new Promise<void>((resolve) => { finishLoad = resolve; });
        return mismatch ? { ...frame, agentId: 'foreign-agent' } : frame;
      } };
    };
    const state = createCompanionState(connector);
    await state.connect('demo-laptop');
    const firstLoad = state.selectTeam('demo-team');
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    await state.selectAgent('demo-reviewer');
    finishLoad();
    await firstLoad;
    expect(state.conversation.value?.agentId).toBe('demo-reviewer');
    const lastGood = state.conversation.value;
    mismatch = true;
    await state.selectAgent('demo-reviewer');
    expect(state.conversation.value).toBe(lastGood);
    expect(state.canSend.value).toBe(false);
    expect(state.error.value).toBe('mobile.errors.loadConversation');
    state.dispose();
  });

  it('closes an in-flight connection if pairing is revoked before it opens', async () => {
    const connector = createDemoConnector();
    const original = await connector.connect('demo-laptop');
    let resolve!: (session: typeof original) => void;
    connector.connect = () => new Promise((r) => { resolve = r; });
    connector.revoke = async () => {};
    const state = createCompanionState(connector);
    const connecting = state.connect('demo-laptop');
    await state.revoke();
    resolve(original);
    await connecting;
    expect(state.status.value).toBe('revoked');
    expect(state.workspace.value.agents).toStrictEqual([]);
    await expect(original.sendPrompt({ hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, 'hello')).rejects.toThrow();
    state.dispose();
  });
  it('lists a team\'s agents in the desktop order, not the order the laptop stores them', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    connector.connect = async (id) => {
      const session = await original(id);
      return { ...session, async getWorkspace() {
        const { teams, agents } = await session.getWorkspace();
        return { teams: [{ ...teams[0]!, agentIds: ['demo-reviewer', 'unknown', 'demo-agent'] }], agents };
      } };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team');
      expect(state.agents.value.map((agent) => agent.id)).toStrictEqual(['demo-reviewer', 'demo-agent']);
    } finally { state.dispose(); }
  });
  it('loads the agent\'s models, saves a model choice on the laptop and sends the choices with the prompt', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const models = [{ id: 'fast', model: 'fast', displayName: 'Fast', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }, { reasoningEffort: 'low', description: '' }] },
      { id: 'deep', model: 'deep-1', displayName: 'Deep', defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }];
    const selectModel = vi.fn(async () => {}); const sendPrompt = vi.fn(async () => {});
    connector.connect = async (id) => ({ ...await original(id), listModels: async () => models, selectModel, sendPrompt });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await vi.waitFor(() => expect(state.models.value).toHaveLength(2));
      expect(state.composerSettings.value).toMatchObject({ model: { id: 'fast' }, reasoningEffort: 'medium', planMode: false });
      state.updateComposerSettings({ modelId: 'deep' });
      expect(selectModel).toHaveBeenCalledExactlyOnceWith('demo-agent', { model: 'deep-1', reasoningEffort: 'high', serviceTier: null });
      state.updateComposerSettings({ planMode: true });
      expect(selectModel).toHaveBeenCalledTimes(1);
      await state.submit('Do it');
      expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Do it', expect.any(String), { model: 'deep-1', planMode: true, reasoningEffort: 'high' });
    } finally { state.dispose(); }
  });
  it('preserves supported reasoning effort across model switches and otherwise selects the middle available effort', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const efforts = (...values: string[]) => values.map(reasoningEffort => ({ reasoningEffort, description: '' }));
    const models = [
      { id: 'first', model: 'first', displayName: 'First', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: efforts('low', 'medium', 'high') },
      { id: 'shared', model: 'shared', displayName: 'Shared', defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts('low', 'high') },
      { id: 'other', model: 'other', displayName: 'Other', defaultReasoningEffort: 'low', supportedReasoningEfforts: efforts('minimal', 'low', 'medium', 'max') },
      { id: 'none', model: 'none', displayName: 'None', supportedReasoningEfforts: [] },
    ];
    const selectModel = vi.fn(async () => {}); const sendPrompt = vi.fn(async () => {});
    connector.connect = async id => ({ ...await original(id), listModels: async () => models, selectModel, sendPrompt });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await vi.waitFor(() => expect(state.models.value).toHaveLength(4));
      state.updateComposerSettings({ modelId: 'shared' });
      expect(state.composerSettings.value?.reasoningEffort).toBe('high');
      expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'shared', reasoningEffort: 'high', serviceTier: null });
      state.updateComposerSettings({ modelId: 'other' });
      expect(state.composerSettings.value?.reasoningEffort).toBe('medium');
      expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'other', reasoningEffort: 'medium', serviceTier: null });
      await state.submit('Do it');
      expect(sendPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'demo-agent' }), 'Do it', expect.any(String), { model: 'other', planMode: false, reasoningEffort: 'medium' });
      state.updateComposerSettings({ modelId: 'none' });
      expect(state.composerSettings.value?.reasoningEffort).toBeNull();
      expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'none', reasoningEffort: null, serviceTier: null });
      state.updateComposerSettings({ modelId: 'first' });
      expect(state.composerSettings.value?.reasoningEffort).toBe('medium');
      expect(selectModel).toHaveBeenLastCalledWith('demo-agent', { model: 'first', reasoningEffort: 'medium', serviceTier: null });
    } finally { state.dispose(); }
  });
  it('sends a prompt to the session it was written for, even if the session is replaced while the draft is saved', async () => {
    const connector = createDemoConnector(); const connect = connector.connect;
    let update!: (workspace: CompanionWorkspace, frame: CompanionConversation | null) => void;
    let workspace!: CompanionWorkspace;
    const sendPrompt = vi.fn(async () => {});
    connector.connect = async id => {
      const session = await connect(id);
      const initial = await session.getWorkspace();
      workspace = { ...initial, agents: initial.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex', threadId: 'original' } })) };
      return { ...session, sendPrompt, getWorkspace: async () => workspace, onUpdate: listener => { update = listener; return () => {}; } };
    };
    let saving: (() => void) | undefined; let hold = false;
    const store = { read: async () => null, write: async () => { if (hold) await new Promise<void>(resolve => { saving = resolve; }); } };
    const state = createCompanionState(connector, store);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      hold = true;
      const sent = state.submit('Ship it');
      await vi.waitFor(() => expect(saving).toBeDefined());
      hold = false;
      workspace = { ...workspace, agents: workspace.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex', threadId: 'replacement' } })) };
      update(workspace, null);
      saving!();
      await sent;
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent', sessionId: JSON.stringify({ kind: 'codex', threadId: 'original' }) }), 'Ship it', expect.any(String), expect.anything());
    } finally { state.dispose(); }
  });
  it('sends attachments with a prompt, even without text, and nothing when there is neither', async () => {
    const connector = createDemoConnector(); const original = connector.connect; const sendPrompt = vi.fn(async () => {});
    connector.connect = async (id) => ({ ...await original(id), sendPrompt });
    const upload = { type: 'image' as const, name: 'photo.jpg', mimeType: 'image/jpeg', data: 'AAAA' };
    const state = createCompanionState(connector, undefined, (references) => references?.length ? [upload] : []);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      await state.submit('   ');
      expect(sendPrompt).not.toHaveBeenCalled();
      await state.submit('', { attachments: [{ type: 'image', reference: 'phone-attachment:1' }] });
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent' }), '(no user instructions)', expect.any(String), { planMode: false }, [upload]);
    } finally { state.dispose(); }
  });
  it('applies a permission change at once, restores it if the laptop refuses, and can stop the agent', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    let workspace!: CompanionWorkspace;
    const setApprovalPreset = vi.fn(async () => {
      workspace = { ...workspace, agents: workspace.agents.map(agent => agent.id === 'demo-agent' ? { ...agent, backendDefaults: { kind: 'codex', approvalPreset: 'full-access' } } : agent) };
    });
    const setPermissionMode = vi.fn(async () => { throw new Error('refused'); }); const interrupt = vi.fn(async () => {});
    connector.connect = async (id) => {
      const session = await original(id); workspace = await session.getWorkspace();
      return { ...session, getWorkspace: async () => workspace, setApprovalPreset, setPermissionMode, interrupt };
    };
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      expect(state.permissions.value).toStrictEqual({ approvalPreset: null, permissionMode: null });
      state.setApprovalPreset('full-access');
      expect(state.permissions.value!.approvalPreset).toBe('full-access');
      expect(setApprovalPreset).toHaveBeenCalledExactlyOnceWith('demo-agent', 'full-access');
      state.setPermissionMode('acceptEdits');
      expect(state.permissions.value!.permissionMode).toBe('acceptEdits');
      await vi.waitFor(() => expect(state.permissions.value!.permissionMode).toBeNull());
      expect(state.permissions.value!.approvalPreset).toBe('full-access');
      state.interrupt();
      expect(interrupt).toHaveBeenCalledExactlyOnceWith('demo-agent');
    } finally { state.dispose(); }
  });
  it('runs Delegate without touching the draft and reports a refused command', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const sendPrompt = vi.fn(async () => {});
    connector.connect = async (id) => ({ ...await original(id), sendPrompt });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.updateDraft({ text: 'half-written thought', selectionStart: 0, selectionEnd: 0 });
      await state.delegate({ startingContext: 'handoff', instructions: 'Run tests' });
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent' }), '/delegate', expect.any(String), { delegation: { startingContext: 'handoff', instructions: 'Run tests' } });
      expect(state.draft.value.text).toBe('half-written thought'); expect(state.error.value).toBe('');
      sendPrompt.mockRejectedValueOnce(new Error('refused'));
      await state.delegate({ startingContext: 'handoff' });
      expect(state.error.value).toBe('mobile.errors.commandFailed');
    } finally { state.dispose(); }
  });
});

it('shows a stale cached conversation immediately but separates its paint generation from completed catch-up', async () => {
  const connector = createDemoConnector(); const connect = connector.connect;
  let stale = false;
  let current!: CompanionWorkspace;
  let publish!: (workspace: CompanionWorkspace, frame: CompanionConversation | null) => void;
  let finish!: (frame: CompanionConversation | null) => void;
  let cached: CompanionConversation | null;
  connector.connect = async id => {
    const session = await connect(id); const base = await session.getWorkspace();
    current = { ...base, agents: base.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex' as const, threadId: agent.id } })) };
    return { ...session, getWorkspace: async () => current, onUpdate: listener => { publish = listener; return () => {}; }, cachedConversation: () => cached, isConversationCurrent: () => !stale,
      async loadConversation(id) {
        if (stale) return new Promise<CompanionConversation | null>(resolve => { finish = resolve; });
        cached = await session.loadConversation(id); return cached;
      },
    };
  };
  const state = createCompanionState(connector);
  try {
    await state.connect('demo-laptop'); await state.selectTeam('demo-team');
    stale = true;
    const refresh = state.selectAgent('demo-agent');
    const cachedGeneration = state.conversationGeneration.value;
    expect(state.conversation.value).toBe(cached!);
    expect(state.loading.value).toBe(false);
    expect(state.refreshing.value).toBe(true);
    expect(state.conversationReady.value).toBe(false);
    publish(current, cached!);
    expect(state.conversationReady.value).toBe(false); // A replayed frame is not the catch-up barrier.
    finish(cached!); await refresh;
    expect(state.conversationGeneration.value).toBeGreaterThan(cachedGeneration);
    expect(state.conversationReady.value).toBe(true);
  } finally { state.dispose(); }
});
