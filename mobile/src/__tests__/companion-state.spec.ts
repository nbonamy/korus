import { describe, expect, it, vi } from 'vitest';
import { createCompanionState } from '../companion-state';
import { createDemoConnector } from '../demo-connector';

describe('companion state', () => {
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
});
