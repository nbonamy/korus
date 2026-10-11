import { describe, expect, it, vi } from 'vitest';
import { createCompanionState } from '../companion-state';
import { createDemoConnector } from '../demo-connector';

describe('companion state', () => {
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
    mismatch = true;
    await state.selectAgent('demo-reviewer');
    expect(state.conversation.value).toBeNull();
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
});
