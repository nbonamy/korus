import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexConversationEvent, SurfaceMessage } from '@codex-app-sdk/core/surface';
import { codexSdkFixture, sdkAgent, sdkSummary } from './sdk-surface-fixture';

const metadata = { seq: 1, origin: 'notification' as const, occurredAt: '2026-09-16T00:00:00Z', conversationId: 'conversation-a', turnId: 'turn' };
const spawn: CodexConversationEvent = { ...metadata, type: 'subagent.toolCallChanged', payload: { lifecycle: 'started', toolCall: {
  id: 'spawn', tool: 'spawnAgent', status: 'inProgress', senderConversationId: 'conversation-a', receiverConversationIds: ['child'], prompt: 'Inspect', model: null, reasoningEffort: null, agentStates: { child: { status: 'running', message: null } },
} } };
const completed: CodexConversationEvent = { ...metadata, conversationId: 'child', type: 'turn.completed', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } };
function message(id: string): SurfaceMessage {
  return { id, turnId: id, role: 'assistant', status: 'complete', createdAt: metadata.occurredAt, parts: [{ type: 'text', text: id }] };
}

describe(`Codex SDK → ${product.name} subagent ownership`, () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  it('projects child identity and completion only to its root owner', async () => {
    const { driver, conversation, surface, events, emit } = setup();
    surface.readConversationSummary.mockResolvedValue(sdkSummary('child', { parentConversationId: 'conversation-a', agentNickname: 'Scout', agentRole: 'reviewer' }));
    await driver.loadConversation(sdkAgent());
    await driver.loadConversation(sdkAgent('agent-b', 'conversation-b'));
    events.length = 0;
    conversation('conversation-a').emit(spawn);
    await vi.waitFor(() => expect(events.some((event) => event.type === 'subagent.identityChanged')).toBe(true));
    emit(completed);
    expect(events.filter((event) => event.type === 'subagent.operationChanged')).toMatchObject([{ agentId: 'agent-a', payload: { rootConversationId: 'conversation-a', operation: { id: 'spawn', receiverConversationIds: ['child'] } } }]);
    expect(events.filter((event) => event.type === 'subagent.statusChanged')).toMatchObject([{ agentId: 'agent-a', payload: { rootConversationId: 'conversation-a', conversationId: 'child', status: 'completed' } }]);
    expect(events.some((event) => event.agentId === 'agent-b')).toBe(false);
    conversation('conversation-a').emit({ ...metadata, type: 'subagent.activity', payload: { lifecycle: 'completed', activity: { id: 'activity', kind: 'interacted', agentConversationId: 'child', agentPath: '/root/scout' } } });
    expect(events.filter((event) => event.type === 'subagent.activityChanged')).toMatchObject([{ agentId: 'agent-a', payload: { rootConversationId: 'conversation-a', activity: { conversationId: 'child', agentPath: '/root/scout' } } }]);
    conversation('conversation-a').emit({ ...metadata, type: 'subagent.activity', payload: { lifecycle: 'completed', activity: { id: 'self', kind: 'interacted', agentConversationId: 'conversation-a', agentPath: '/root' } } });
    expect(events.filter((event) => event.type === 'subagent.activityChanged')).toHaveLength(1);
    driver.releaseConversation('agent-a');
    events.length = 0;
    emit(completed);
    expect(events).toStrictEqual([]);
  });

  it('reads live child snapshots without inherited-history loads, but bounds cold historical children to the final message', async () => {
    const { driver, conversation, surface, events, emit } = setup();
    surface.readConversationSummary.mockResolvedValue(sdkSummary('child'));
    await driver.loadConversation(sdkAgent());
    conversation('conversation-a').emit(spawn);
    emit(completed);
    conversation('child').setSnapshot({ messages: [message('first'), message('second')] });
    const live = await driver.readConversationMessages({ backend: 'codex', threadId: 'child' }, 'agent-a');
    expect(live.map((item) => item.parts)).toStrictEqual([[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]]);
    expect(conversation('child').handle.readHistory).not.toHaveBeenCalled();
    conversation('cold').handle.readHistory.mockResolvedValue({ conversationId: 'cold', messages: [message('inherited'), message('final')], threadStatus: { type: 'idle' } });
    const cold = await driver.readConversationMessages({ backend: 'codex', threadId: 'cold' }, 'agent-a');
    expect(cold.map((item) => item.parts)).toStrictEqual([[{ type: 'text', text: 'final' }]]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'subagent.statusChanged', agentId: 'agent-a', payload: { rootConversationId: 'conversation-a', conversationId: 'cold', status: 'completed' } }));
  });

  it('does not publish a delayed child identity after its root is replaced', async () => {
    const { driver, conversation, surface, events } = setup();
    let resolve!: (summary: ReturnType<typeof sdkSummary>) => void;
    surface.readConversationSummary.mockReturnValue(new Promise((done) => { resolve = done; }));
    await driver.loadConversation(sdkAgent());
    conversation('conversation-a').emit(spawn);
    await driver.loadConversation(sdkAgent('agent-a', 'replacement'));
    events.length = 0;
    resolve(sdkSummary('child', { agentNickname: 'Late' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(events.filter((event) => event.type === 'subagent.identityChanged')).toStrictEqual([]);
  });
});
