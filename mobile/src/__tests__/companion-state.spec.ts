import { describe, expect, it, vi } from 'vitest';
import { createCompanionState } from '../companion-state';
import { createDemoConnector } from '../demo-connector';

describe('companion state', () => {
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
    connector.connect = async (id) => {
      const session = await original(id); let workspace = await session.getWorkspace();
      closeSession.mockImplementation(async () => { workspace = { ...workspace, agents: workspace.agents.filter((agent) => agent.id !== target.agentId) }; });
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
      await state.confirmCloseSession('demo-agent', deleting, deleting, deleting);
      expect(closeSession).toHaveBeenCalledExactlyOnceWith(target, deleting ? { deleteWorktree: true, deleteRemoteBranch: true, discardChanges: true, confirmed: true } : undefined);
      expect(state.closePreview.value).toBeNull();
      expect(state.agentId.value).toBe('demo-reviewer');
      expect(state.conversation.value?.agentId).toBe('demo-reviewer');
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
    const loadConversation = vi.fn(initial.loadConversation).mockImplementationOnce(initial.loadConversation).mockRejectedValueOnce(new Error('History response interrupted'));
    connector.connect = async (id) => ({ ...await connect(id), loadConversation });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      const original = state.conversation.value;
      expect(original?.payload.snapshot.messages.length).toBeGreaterThan(0);
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
    expect(state.status.value).toBe('error');
    expect(state.workspace.value.agents).toStrictEqual([]);
    await state.connect('demo-laptop');
    expect(state.status.value).toBe('connected');
    await state.selectTeam('demo-team');
    await state.selectAgent('demo-agent');
    state.updateDraft({ text: 'Dictated prompt', selectionStart: 15, selectionEnd: 15 });
    await state.selectAgent('other-agent');
    expect(state.agent.value).toBeNull();
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
    await state.selectTeam('demo-team');
    const firstLoad = state.selectAgent('demo-agent');
    await Promise.resolve();
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
    await expect(original.sendPrompt('demo-agent', 'hello')).rejects.toThrow();
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
      expect(sendPrompt).toHaveBeenCalledWith('demo-agent', 'Do it', expect.any(String), { model: 'deep-1', planMode: true, reasoningEffort: 'high' });
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
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('demo-agent', '', expect.any(String), { planMode: false }, [upload]);
    } finally { state.dispose(); }
  });
  it('applies a permission change at once, restores it if the laptop refuses, and can stop the agent', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const setApprovalPreset = vi.fn(async () => {}); const setPermissionMode = vi.fn(async () => { throw new Error('refused'); }); const interrupt = vi.fn(async () => {});
    connector.connect = async (id) => ({ ...await original(id), setApprovalPreset, setPermissionMode, interrupt });
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
  it('runs Delegate and Review without touching the draft, and reports a refused command', async () => {
    const connector = createDemoConnector(); const original = connector.connect;
    const sendPrompt = vi.fn(async () => {}); const startReview = vi.fn(async () => { throw new Error('refused'); });
    connector.connect = async (id) => ({ ...await original(id), sendPrompt, startReview });
    const state = createCompanionState(connector);
    try {
      await state.connect('demo-laptop'); await state.selectTeam('demo-team'); await state.selectAgent('demo-agent');
      state.updateDraft({ text: 'half-written thought', selectionStart: 0, selectionEnd: 0 });
      await state.delegate({ startingContext: 'handoff', instructions: 'Run tests' });
      expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('demo-agent', '/delegate', expect.any(String), { delegation: { startingContext: 'handoff', instructions: 'Run tests' } });
      expect(state.draft.value.text).toBe('half-written thought'); expect(state.error.value).toBe('');
      await state.startReview({ scope: { type: 'uncommitted' }, threadMode: 'independent' });
      expect(startReview).toHaveBeenCalledWith('demo-agent', { scope: { type: 'uncommitted' }, threadMode: 'independent' });
      expect(state.error.value).toBe('mobile.errors.commandFailed');
    } finally { state.dispose(); }
  });
});
