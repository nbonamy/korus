import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexSdkFixture, sdkAgent, sdkSnapshot, sdkSummary } from './sdk-surface-fixture';

const metadata = { seq: 1, origin: 'notification' as const, occurredAt: '2026-09-16T00:00:00Z', conversationId: 'conversation-a', turnId: 'turn' };
const completion = { status: 'completed' as const, error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null };

describe(`Codex SDK → ${product.name} session policy`, () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  it('lists current and archived conversations in the exact folder, hiding other attached agents', async () => {
    const { driver, surface } = setup();
    surface.listConversations.mockResolvedValueOnce([sdkSummary('conversation-a'), sdkSummary('another-live')])
      .mockResolvedValueOnce([sdkSummary('old', { updatedAt: '2026-09-01T00:00:00Z' }), sdkSummary('recent')]);
    const result = await driver.listConversations(sdkAgent(), { limit: 10, searchTerm: ' query ' });
    expect(result.map(({ id, storageState }) => ({ id, storageState }))).toStrictEqual([
      { id: 'conversation-a', storageState: 'active' }, { id: 'recent', storageState: 'archived' }, { id: 'old', storageState: 'archived' },
    ]);
    expect(surface.listConversations.mock.calls).toStrictEqual([
      [{ cwd: '/repo', limit: 10, searchTerm: 'query' }], [{ cwd: '/repo', limit: 10, searchTerm: 'query', archived: true }],
    ]);
  });

  it('reconciles only unowned top-level sessions and restores attached archived sessions', async () => {
    const { driver, surface } = setup();
    const reviewAgent = sdkAgent('review-owner', 'review-thread');
    reviewAgent.codeReview = {
      id: 'review', targetAgentId: 'agent-a', reviewerAgentId: reviewAgent.id,
      scope: { type: 'uncommitted' }, threadMode: 'independent',
      status: 'ready', activeRoundId: 'round', createdAt: metadata.occurredAt, updatedAt: metadata.occurredAt,
      rounds: [{
        id: 'round', number: 1, status: 'ready', findings: [], startedAt: metadata.occurredAt,
        reviewerSession: { kind: 'codex', threadId: 'review-thread' },
      }],
    };
    surface.listConversations.mockResolvedValueOnce([
      sdkSummary('conversation-a'), sdkSummary('review-thread'), sdkSummary('orphan'),
      sdkSummary('child', { parentConversationId: 'conversation-a' }),
    ]).mockResolvedValueOnce([sdkSummary('attached-archived'), sdkSummary('other-archive')]);
    await driver.reconcileConversations([sdkAgent(), sdkAgent('b', 'attached-archived'), reviewAgent]);
    expect(surface.archiveConversation).toHaveBeenCalledExactlyOnceWith('orphan');
    expect(surface.unarchiveConversation).toHaveBeenCalledExactlyOnceWith('attached-archived');
  });

  it('creates and restores quick chats without a folder or a forced title and adopts the SDK title', async () => {
    const { driver, surface, conversation, emit, events } = setup();
    const agent = { ...sdkAgent(), folder: null, name: null, sessionKind: 'quickChat' as const, backendSession: undefined };
    surface.createConversation.mockResolvedValue(sdkSnapshot());
    await driver.sendPrompt(agent, 'hello');
    expect(surface.createConversation).toHaveBeenCalledWith({ threadSource: 'user' }, { extensionContext: agent });
    expect(conversation('conversation-a').handle.rename).not.toHaveBeenCalled();
    emit({ ...metadata, type: 'conversation.summaryUpserted', payload: { reason: 'updated', summary: sdkSummary('conversation-a', { title: 'A generated title' }) } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.updated', payload: expect.objectContaining({ conversationTitle: 'A generated title' }) }));
    driver.releaseConversation(agent.id);
    await driver.loadConversation({ ...agent, backendSession: { kind: 'codex', threadId: 'conversation-a' } });
    expect(conversation('conversation-a').handle.load).toHaveBeenLastCalledWith({ extensionContext: expect.objectContaining({ id: agent.id }) });
    surface.readConversationSummary.mockResolvedValue(sdkSummary('conversation-a', { title: 'Updated after completion' }));
    conversation('conversation-a').emit({ ...metadata, type: 'turn.completed', payload: completion });
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'agent.updated', payload: expect.objectContaining({ conversationTitle: 'Updated after completion' }) })));
  });

  it('restores persisted fast mode after cold load and delegates paging without implementing history', async () => {
    const { driver, conversation } = setup();
    const session = conversation('conversation-a');
    session.handle.loadOlderHistory.mockResolvedValue({ conversationId: 'conversation-a', messages: [], hasOlder: true });
    const agent = { ...sdkAgent(), backendDefaults: { kind: 'codex' as const, serviceTier: 'fast' } };
    await driver.loadConversation(agent);
    expect(session.handle.updateSettings).toHaveBeenCalledWith({ serviceTier: 'fast' });
    await expect(driver.loadOlderHistory(agent)).resolves.toStrictEqual({ hasOlder: true });
    expect(session.handle.loadOlderHistory).toHaveBeenCalledOnce();
    await driver.loadTurnHistory(agent, 'older-turn');
    expect(session.handle.loadTurnHistory).toHaveBeenCalledExactlyOnceWith('older-turn');
    session.handle.loadTurnHistory.mockRejectedValueOnce(new Error('details unavailable'));
    await expect(driver.loadTurnHistory(agent, 'older-turn')).rejects.toThrow('details unavailable');
    session.handle.loadOlderHistory.mockRejectedValueOnce(new Error('page unavailable'));
    await expect(driver.loadOlderHistory(agent)).rejects.toThrow('page unavailable');
  });

  it('restores the selected tier rather than a stale thread default on cold load', async () => {
    const { driver, conversation } = setup();
    const session = conversation('conversation-a');
    session.setSnapshot({ selectedServiceTier: 'fast' });
    const agent = {
      ...sdkAgent(),
      backendDefaults: { kind: 'codex' as const, model: 'sol', reasoningEffort: 'high', serviceTier: null, userSelectedModel: true },
    };

    await driver.loadConversation(agent);

    expect(session.handle.updateSettings).toHaveBeenCalledWith({ serviceTier: null });
  });

  it.each([false, true])('rolls over via a bounded handoff and archives only after replacement acceptance (failure=%s)', async (fail) => {
    const { driver, surface, conversation, events } = setup();
    const session = conversation('conversation-a');
    const agent = { ...sdkAgent(), backendDefaults: { kind: 'codex' as const, model: 'original', reasoningEffort: 'high', serviceTier: 'fast' } };
    await driver.loadConversation(agent);
    events.length = 0;
    session.handle.sendMessage.mockImplementationOnce(async () => {
      session.setSnapshot({ turnIds: ['handoff'], messages: [{ id: 'answer', turnId: 'handoff', role: 'assistant', status: 'complete', createdAt: metadata.occurredAt, parts: [{ type: 'text', text: 'Carry this context forward.' }] }] });
      session.emit({ ...metadata, turnId: 'handoff', type: 'turn.completed', payload: completion });
      return session.handle.getSnapshot();
    });
    surface.createConversation.mockResolvedValue(sdkSnapshot('replacement'));
    const order: string[] = [];
    conversation('replacement').handle.sendMessage.mockImplementationOnce(async () => {
      order.push('replacement-acceptance');
      if (fail) throw new Error('replacement rejected');
      return sdkSnapshot('replacement');
    });
    surface.archiveConversation.mockImplementation(async (id) => { order.push(`archive:${id}`); return sdkSnapshot(id); });
    if (fail) {
      await expect(driver.replaceConversationWithSummary(agent)).rejects.toThrow('replacement rejected');
      expect(order).toStrictEqual(['replacement-acceptance', 'archive:replacement']);
      expect(session.listenerCount()).toBe(1);
    } else {
      await expect(driver.replaceConversationWithSummary(agent)).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'replacement' } });
      expect(order).toStrictEqual(['replacement-acceptance', 'archive:conversation-a']);
      expect(session.listenerCount()).toBe(0);
    }
    expect(session.handle.sendMessage).toHaveBeenCalledWith(expect.any(String), { model: 'gpt-5.6-luna', reasoningEffort: 'low' });
    expect(surface.createConversation).toHaveBeenCalledWith({ cwd: '/repo', threadSource: 'user', model: 'original', reasoningEffort: 'high', serviceTier: 'fast' }, { extensionContext: agent });
    expect(conversation('replacement').handle.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Carry this context forward.'));
    expect(events.filter((event) => event.type === 'codex.conversationEventReceived')).toStrictEqual([]);
    expect(agent.backendDefaults.model).toBe('original');
  });
});
