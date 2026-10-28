import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexSdkFixture, sdkAgent, sdkSnapshot } from './sdk-surface-fixture';

describe(`Codex SDK → ${product.name} backend lifecycle`, () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); vi.useRealTimers(); });

  it('returns the public canonical user-message binding for a shared submission', async () => {
    const { driver, conversation } = setup();
    const message = { id: 'public-client-message-id', role: 'user' as const, status: 'complete' as const, turnId: 'shared-turn', parts: [{ type: 'text' as const, text: 'Identical prompt' }] };
    conversation('conversation-a').handle.sendMessage.mockResolvedValue(sdkSnapshot('conversation-a', { turnIds: ['shared-turn'], activeTurnId: 'shared-turn', messages: [message] }));
    await expect(driver.sendPrompt(sdkAgent(), 'Identical prompt')).resolves.toMatchObject({ turnId: 'shared-turn', messageId: 'public-client-message-id' });
    // Canonical history may replace rows; the admitted public client ID, not text or position, is the binding.
    conversation('conversation-a').handle.sendMessage.mockResolvedValue(sdkSnapshot('conversation-a', { turnIds: ['shared-turn', 'another-turn'], messages: [{ ...message, id: 'other-client-id', turnId: 'another-turn' }] }));
    await expect(driver.sendPrompt(sdkAgent(), 'Identical prompt')).resolves.toMatchObject({ turnId: 'another-turn', messageId: 'other-client-id' });
  });

  it('creates a user conversation in the assigned folder and sends prepared options to that handle', async () => {
    const { driver, surface, conversation } = setup();
    const agent = { ...sdkAgent(), backendSession: undefined };
    surface.createConversation.mockResolvedValue(sdkSnapshot());
    conversation('conversation-a').handle.sendMessage.mockResolvedValue(sdkSnapshot('conversation-a', { turnIds: ['accepted'], activeTurnId: 'accepted' }));
    const delegation = { startingContext: 'handoff' as const, instructions: 'Task-specific direction' };
    const options = driver.preparePromptOptions(agent, { planMode: true, delegation, selection: { model: 'model', reasoningEffort: 'high', serviceTier: 'fast' } });
    expect(options?.delegation).toStrictEqual(delegation);
    await expect(driver.sendPrompt(agent, 'Implement', options)).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'conversation-a' }, turnId: 'accepted' });
    expect(surface.createConversation).toHaveBeenCalledWith({ cwd: '/repo', threadSource: 'user' }, { extensionContext: agent });
    expect(conversation('conversation-a').handle.sendMessage).toHaveBeenCalledWith('Implement', { model: 'model', reasoningEffort: 'high', serviceTier: 'fast', planMode: true });
    expect(conversation('conversation-a').handle.rename).toHaveBeenCalledWith('agent-a');
    const skills = [{ name: 'check', path: '/repo/check/SKILL.md' }];
    await driver.sendPrompt(agent, 'Check', driver.preparePromptOptions(agent, { skills }));
    expect(conversation('conversation-a').handle.sendMessage).toHaveBeenLastCalledWith('Check', { skills });
  });

  it('propagates SDK rejection without fabricating a successful turn and permits retry', async () => {
    const { driver, conversation } = setup();
    const handle = conversation('conversation-a').handle;
    handle.sendMessage.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(sdkSnapshot('conversation-a', { turnIds: ['retry'] }));
    await expect(driver.sendPrompt(sdkAgent(), 'hello')).rejects.toThrow('offline');
    await expect(driver.sendPrompt(sdkAgent(), 'hello')).resolves.toMatchObject({ turnId: 'retry' });
    expect(handle.load).toHaveBeenCalledOnce();
  });

  it('shares a fresh agent conversation between overlapping title synchronization and its first prompt', async () => {
    const { driver, surface, conversation } = setup();
    const agent = { ...sdkAgent(), backendSession: undefined };
    let finishCreation!: () => void;
    const creation = new Promise<void>((resolve) => { finishCreation = resolve; });
    let created = 0;
    surface.createConversation.mockImplementation(async () => {
      const id = `created-${++created}`;
      await creation;
      return sdkSnapshot(id);
    });
    conversation('created-1').handle.sendMessage.mockResolvedValue(sdkSnapshot('created-1', { turnIds: ['accepted'] }));

    const title = driver.setConversationTitle(agent, 'Issue 61');
    const prompt = driver.sendPrompt(agent, 'My custom instructions');
    await vi.waitFor(() => expect(surface.createConversation).toHaveBeenCalled());
    finishCreation();
    await title;
    await expect(prompt).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'created-1' }, turnId: 'accepted' });
    expect(surface.createConversation).toHaveBeenCalledOnce();
    expect(surface.forgetConversation).not.toHaveBeenCalled();
    expect(conversation('created-1').handle.rename).toHaveBeenCalledWith('Issue 61');
    expect(conversation('created-1').handle.sendMessage).toHaveBeenCalledWith('My custom instructions', {});
  });

  it('allows another agent to start while creation is pending and retries a failed initialization', async () => {
    const { driver, surface, conversation } = setup();
    const firstAgent = { ...sdkAgent(), backendSession: undefined };
    const secondAgent = { ...sdkAgent('agent-b'), backendSession: undefined };
    let rejectCreation!: (error: Error) => void;
    surface.createConversation.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCreation = reject; }));
    surface.createConversation.mockResolvedValue(sdkSnapshot('independent'));
    const first = expect(driver.sendPrompt(firstAgent, 'first')).rejects.toThrow('creation failed');
    await vi.waitFor(() => expect(surface.createConversation).toHaveBeenCalledOnce());
    await expect(driver.sendPrompt(secondAgent, 'independent')).resolves.toMatchObject({ backendSession: { threadId: 'independent' } });
    rejectCreation(new Error('creation failed'));
    await first;
    surface.createConversation.mockResolvedValue(sdkSnapshot('retry'));
    await expect(driver.sendPrompt(firstAgent, 'retry')).resolves.toMatchObject({ backendSession: { threadId: 'retry' } });
    expect(conversation('retry').handle.sendMessage).toHaveBeenCalledWith('retry', {});
    expect(surface.forgetConversation).not.toHaveBeenCalledWith('independent');
  });

  it.each(['release', 'close'] as const)('does not start the first prompt after %s during conversation creation', async (action) => {
    const { driver, surface, conversation } = setup();
    let finishCreation!: () => void;
    surface.createConversation.mockImplementation(() => new Promise((resolve) => { finishCreation = () => resolve(sdkSnapshot()); }));
    const prompt = expect(driver.sendPrompt({ ...sdkAgent(), backendSession: undefined }, 'cancelled')).rejects.toThrow(/initialization.*cancelled/i);
    await vi.waitFor(() => expect(surface.createConversation).toHaveBeenCalledOnce());
    if (action === 'close') await driver.close();
    else driver.releaseConversation('agent-a');
    finishCreation();
    await prompt;
    expect(conversation('conversation-a').handle.sendMessage).not.toHaveBeenCalled();
    expect(conversation('conversation-a').listenerCount()).toBe(0);
  });

  it('restores an archived target before displacing the attached conversation', async () => {
    const { driver, surface, conversation } = setup();
    const order: string[] = [];
    surface.unarchiveConversation.mockImplementation(async (id) => { order.push(`restore:${id}`); return sdkSnapshot(id); });
    conversation('archived').handle.load.mockImplementation(async () => { order.push('load:archived'); return sdkSnapshot('archived'); });
    surface.archiveConversation.mockImplementation(async (id) => { order.push(`archive:${id}`); return sdkSnapshot(id); });
    await expect(driver.resumeConversation(sdkAgent(), { ref: { backend: 'codex', threadId: 'archived' }, storageState: 'archived' })).resolves.toMatchObject({ backendSession: { kind: 'codex', threadId: 'archived' } });
    expect(order).toStrictEqual(['restore:archived', 'load:archived', 'archive:conversation-a']);
  });

  it('rolls back failed restoration and keeps subsequent prompts on the previous conversation', async () => {
    const { driver, surface, conversation } = setup();
    conversation('broken').handle.load.mockRejectedValueOnce(new Error('cannot load'));
    await expect(driver.resumeConversation(sdkAgent(), { ref: { backend: 'codex', threadId: 'broken' }, storageState: 'archived' })).rejects.toThrow('cannot load');
    expect(surface.archiveConversation).toHaveBeenCalledExactlyOnceWith('broken');
    await driver.sendPrompt(sdkAgent(), 'continue');
    expect(conversation('conversation-a').handle.sendMessage).toHaveBeenCalledOnce();
    expect(conversation('broken').handle.sendMessage).not.toHaveBeenCalled();
    expect(conversation('broken').listenerCount()).toBe(0);
  });

  it('deletes the attached conversation through the SDK, and does nothing without a thread', async () => {
    const { driver, surface } = setup();
    await driver.deleteAgentConversation(sdkAgent());
    expect(surface.deleteConversation).toHaveBeenCalledExactlyOnceWith('conversation-a');
    await driver.deleteAgentConversation({ ...sdkAgent(), backendSession: undefined });
    expect(surface.deleteConversation).toHaveBeenCalledOnce();
  });

  it('does not detach an attached conversation when archive fails', async () => {
    const { driver, surface, conversation } = setup();
    await driver.loadConversation(sdkAgent());
    surface.archiveConversation.mockRejectedValueOnce(new Error('archive failed'));
    await expect(driver.archiveAgentConversation(sdkAgent())).rejects.toThrow('archive failed');
    await driver.sendPrompt(sdkAgent(), 'still attached');
    expect(conversation('conversation-a').handle.load).toHaveBeenCalledOnce();
    expect(conversation('conversation-a').handle.sendMessage).toHaveBeenCalledWith('still attached', {});
  });

  it.each([false, true])('cold hydration interrupts orphaned work except an active goal (goal=%s)', async (activeGoal) => {
    const { driver, conversation } = setup();
    const session = conversation('conversation-a');
    session.setSnapshot({ activeTurnId: 'old-turn', busy: true, ...(activeGoal ? { goal: { threadId: 'conversation-a', objective: 'finish', status: 'active', tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 } } : {}) });
    await driver.loadConversation(sdkAgent());
    expect(session.handle.interrupt).toHaveBeenCalledTimes(activeGoal ? 0 : 1);
  });

  it('reuses fresh snapshots, refreshes expired idle history, and retains live history', async () => {
    vi.useFakeTimers();
    const { driver, conversation, events } = setup();
    const session = conversation('conversation-a');
    session.setSnapshot({ messages: [{ id: 'cached', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Cached answer' }], createdAt: '2026-09-16T00:00:00Z' }] });
    await driver.loadConversation(sdkAgent());
    events.length = 0;
    await driver.loadConversation(sdkAgent());
    expect(session.handle.load).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'codex.conversationSnapshotChanged')).toMatchObject([{ payload: { snapshot: { messages: session.handle.getSnapshot().messages } } }]);
    vi.advanceTimersByTime(16 * 60_000);
    await driver.loadConversation(sdkAgent());
    expect(session.handle.load).toHaveBeenCalledTimes(2);
    session.setSnapshot({ activeTurnId: 'live', busy: true });
    vi.advanceTimersByTime(16 * 60_000);
    await driver.loadConversation(sdkAgent());
    expect(session.handle.load).toHaveBeenCalledTimes(2);
  });

  it('drops old subscriptions when the agent changes conversation and on close', async () => {
    const { driver, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    await driver.loadConversation(sdkAgent('agent-a', 'replacement'));
    expect(conversation('conversation-a').listenerCount()).toBe(0);
    events.length = 0;
    conversation('conversation-a').emit({ type: 'conversation.activityChanged', seq: 1, origin: 'notification', occurredAt: '2026-09-16T00:00:00Z', conversationId: 'conversation-a', payload: { busy: true, error: null, threadStatus: null } });
    expect(events).toStrictEqual([]);
    await driver.close();
    expect(conversation('replacement').listenerCount()).toBe(0);
  });
});
