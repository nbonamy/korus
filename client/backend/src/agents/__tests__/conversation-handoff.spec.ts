import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import { handOffConversation } from '../conversation-handoff';
import { scriptedDriver } from '../../__tests__/support/scripted-driver';

const prompts = { request: 'Write the handoff.', continuation: (summary: string) => `Background:\n${summary}`, model: 'small', reasoningEffort: 'low', maxCharacters: 20 };
const agent = (provider: Agent['provider'], id: string, session?: Agent['providerSession']): Agent => ({ id, name: id, avatar: 'A', folder: '/repo', provider, providerSession: session, status: { type: 'idle' }, createdAt: '', updatedAt: '' } as Agent);
const codexSession = { kind: 'codex', conversationId: 'old-thread' } as const;

describe('handing a conversation from one harness to another', () => {
  it('summarizes on the first harness, starts the second with the summary and archives the first conversation', async () => {
    const first = scriptedDriver('codex'); const second = scriptedDriver('claude');
    first.script.on('executeScopedPrompt', async () => ({ text: '  The summary.  ', session: codexSession }));
    const source = agent('codex', 'source', codexSession);
    await first.driver.loadConversation!(source);
    const result = await handOffConversation({ from: { driver: first.driver, agent: source }, to: { driver: second.driver, agent: agent('claude', 'target') }, prompts, archiveSource: true });
    expect(result.summary).toBe('The summary.');
    expect(first.script.calls('executeScopedPrompt')[0]!.args[1]).toMatchObject({ prompt: 'Write the handoff.', cwd: '/repo' });
    expect(second.script.calls('sendPrompt')[0]!.args[1]).toBe('Background:\nThe summary.');
    expect(first.script.calls('setConversationStorage')[0]!.args[1]).toBe('archived');
    expect(result.providerSession).toMatchObject({ kind: 'claude' });
  });

  it('works the same when both sides are one harness, as when compressing a session', async () => {
    const both = scriptedDriver('codex');
    both.script.on('executeScopedPrompt', async () => ({ text: 'Notes', session: codexSession }));
    const source = agent('codex', 'same', codexSession);
    await both.driver.loadConversation!(source);
    const result = await handOffConversation({ from: { driver: both.driver, agent: source }, to: { driver: both.driver, agent: { ...source, providerSession: undefined } }, prompts, archiveSource: true });
    expect(both.script.calls('sendPrompt')[0]!.args[1]).toBe('Background:\nNotes');
    expect(result.providerSession).toMatchObject({ kind: 'codex' });
  });

  it('keeps the first conversation when the second harness does not accept the summary', async () => {
    const first = scriptedDriver('codex'); const second = scriptedDriver('claude');
    first.script.on('executeScopedPrompt', async () => ({ text: 'Notes', session: codexSession }));
    second.script.on('sendPrompt', async () => { throw new Error('rejected'); });
    const source = agent('codex', 'source', codexSession);
    await first.driver.loadConversation!(source);
    await expect(handOffConversation({ from: { driver: first.driver, agent: source }, to: { driver: second.driver, agent: agent('claude', 'target') }, prompts, archiveSource: true })).rejects.toThrow('rejected');
    expect(first.script.calls('setConversationStorage')).toHaveLength(0);
  });

  it('rejects an empty summary, bounds a long one, and needs a harness that can run a scoped prompt', async () => {
    const first = scriptedDriver('codex'); const second = scriptedDriver('claude');
    const source = agent('codex', 'source', codexSession);
    await first.driver.loadConversation!(source);
    first.script.on('executeScopedPrompt', async () => ({ text: '   ', session: codexSession }));
    const input = { from: { driver: first.driver, agent: source }, to: { driver: second.driver, agent: agent('claude', 'target') }, prompts };
    await expect(handOffConversation(input)).rejects.toThrow('empty');
    first.script.on('executeScopedPrompt', async () => ({ text: 'x'.repeat(100), session: codexSession }));
    await handOffConversation(input);
    expect(second.script.calls('sendPrompt').at(-1)!.args[1]).toBe(`Background:\n${'x'.repeat(20)}`);
    const plain = scriptedDriver('cursor', { unsupported: ['executeScopedPrompt'] });
    await expect(handOffConversation({ ...input, from: { driver: plain.driver, agent: agent('cursor', 'c') } })).rejects.toThrow(/does not support/);
  });
});
