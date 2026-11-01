import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexConversationSnapshot, CodexSurfaceSkill } from '@codex-app-sdk/core/surface';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import { codexSdkFixture, sdkAgent } from './sdk-surface-fixture';

const metadata = { seq: 1, origin: 'notification' as const, occurredAt: '2026-09-16T00:00:00Z', conversationId: 'conversation-a', turnId: 'turn' };
const goal = { threadId: 'conversation-a', objective: 'finish', status: 'active' as const, tokenBudget: null, tokensUsed: 2, timeUsedSeconds: 3, createdAt: 0, updatedAt: 1 };

describe('Codex SDK → app-owned projections', () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  it.each([
    [{}, 'idle'],
    [{ busy: true }, 'working'],
    [{ goal }, 'working'],
    [{ error: 'provider failed' }, 'error'],
    [{ threadStatus: { type: 'active', activeFlags: ['waitingOnApproval'] } }, 'awaitingInput'],
    [{ clientRequests: [{ id: 'async', conversationId: 'conversation-a', turnId: 'turn', itemId: 'item', kind: 'ask_user', payload: { request: { itemId: 'item', delivery: 'async', blocking: false, questions: [] } } }] }, 'idle'],
    [{ clientRequests: [{ id: 'blocking', conversationId: 'conversation-a', turnId: 'turn', itemId: 'item', kind: 'ask_user', payload: { request: { itemId: 'item', delivery: 'tool', blocking: true, questions: [] } } }] }, 'awaitingInput'],
  ] satisfies Array<[Partial<CodexConversationSnapshot>, string]>)('maps snapshot %j to %s without fabricating provider activity', async (snapshot, status) => {
    const { driver, conversation, events } = setup();
    conversation('conversation-a').setSnapshot(snapshot);
    await driver.loadConversation(sdkAgent());
    expect(events.filter((event) => event.type === 'agent.statusChanged')).toMatchObject([{ payload: { type: status } }]);
    expect(conversation('conversation-a').handle.interrupt).not.toHaveBeenCalled();
  });

  it.each([
    ['question', true, false, 'working'],
    ['question', false, false, 'idle'],
    ['question', true, true, 'awaitingInput'],
    ['approval', true, false, 'working'],
    ['approval', false, false, 'idle'],
    ['approval', true, true, 'awaitingInput'],
  ] as const)('refreshes Input when %s resolves without another activity event (busy=%s, pending=%s)', async (kind, busy, pending, status) => {
    const { driver, conversation, events } = setup();
    const session = conversation('conversation-a');
    const request = {
      id: 'question', conversationId: 'conversation-a', turnId: 'turn', itemId: 'item',
      kind: 'ask_user' as const,
      payload: { request: { itemId: 'item', delivery: 'tool' as const, blocking: true, questions: [] } },
    };
    const approval = {
      id: 'approval', conversationId: 'conversation-a', itemId: 'item',
      kind: 'command' as const, title: 'Run tests', canDeny: true, allowedScopes: ['once' as const],
    };
    session.setSnapshot({ busy, clientRequests: kind === 'question' ? [request] : [], approvals: kind === 'approval' ? [approval] : [] });
    await driver.loadConversation(sdkAgent());
    const latestStatus = () => events.filter(event => event.type === 'agent.statusChanged').at(-1)?.payload;
    expect(latestStatus()).toMatchObject({ type: 'awaitingInput' });

    // SDK activity events are deduplicated by busy/threadStatus/error, not pending requests.
    session.setSnapshot({ busy, answeredClientRequestIds: [request.id], clientRequests: pending ? [{ ...request, id: 'another-question' }] : [] });
    if (kind === 'question') session.emit({ ...metadata, origin: 'action', type: 'clientRequest.resolved', payload: {
      request, response: { id: request.id, payload: { answers: {} } }, reason: 'host',
    } });
    else session.emit({ ...metadata, origin: 'action', type: 'approval.resolved', payload: {
      approval, decision: 'approve', scope: 'once', reason: 'host',
    } });

    expect(latestStatus()).toMatchObject({ type: status });
  });

  it('projects goal changes and clearing but does not duplicate action-owned updates', async () => {
    const { driver, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    const session = conversation('conversation-a');
    events.length = 0;
    session.emit({ ...metadata, type: 'conversation.goalChanged', payload: { goal: { ...goal, status: 'complete' } } });
    session.emit({ ...metadata, type: 'conversation.goalChanged', payload: { goal: null } });
    session.emit({ ...metadata, origin: 'action', type: 'conversation.goalChanged', payload: { goal } });
    expect(events.filter((event) => event.type === 'conversation.goalUpdated' || event.type === 'conversation.goalCleared')).toMatchObject([
      { type: 'conversation.goalUpdated', payload: { goal: { status: 'complete' } } },
      { type: 'conversation.goalCleared', payload: {} },
    ]);
    session.setSnapshot({ goal });
    await expect(driver.setGoal(sdkAgent(), 'finish')).resolves.toMatchObject({ goal });
    await expect(driver.clearGoal(sdkAgent())).resolves.toMatchObject({ cleared: true });
    expect(session.handle.setGoal).toHaveBeenCalledWith('finish', undefined);
    expect(session.handle.clearGoal).toHaveBeenCalledOnce();
  });

  it.each(['read', 'edit', 'create'] as const)('projects SDK %s file activity with its exact owner and path', async (action) => {
    const { driver, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    events.length = 0;
    const payload = { messageId: 'message', itemId: 'file', path: '/repo/file.ts', action, status: 'completed' as const };
    conversation('conversation-a').emit({ ...metadata, type: 'file.activity', payload });
    expect(events.filter((event) => event.type === 'workspace.fileActivityDetected')).toMatchObject([{ agentId: 'agent-a', conversationId: 'conversation-a', turnId: 'turn', payload }]);
  });

  it('sanitizes nullable SDK skill fields at both catalog and pushed-event boundaries', async () => {
    const { driver, surface, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    // Recorded SDK output once violated its optional-string declaration; test the defensive boundary deliberately.
    const skills = [{ name: 'review', description: 'Review', path: '/repo/SKILL.md', enabled: true, brandColor: null, defaultPrompt: null }] as unknown as CodexSurfaceSkill[];
    surface.listSkills.mockResolvedValue(skills);
    expect(await driver.listSkills(sdkAgent())).toStrictEqual([{ id: '/repo/SKILL.md', name: 'review', description: 'Review', path: '/repo/SKILL.md', enabled: true }]);
    expect(surface.listSkills).toHaveBeenCalledWith({ cwd: '/repo', forceReload: false });
    conversation('conversation-a').emit({ ...metadata, type: 'conversation.skillsChanged', payload: { cwd: '/repo', status: 'loaded', skills } });
    const event = events.find((entry) => entry.type === 'skills.changed')!;
    const wireEvent = { ...event, seq: 1, occurredAt: metadata.occurredAt };
    expect(decodeAppBackendEvent(wireEvent)).toBe(wireEvent);
    surface.listSkills.mockResolvedValue([{ ...skills[0]!, brandColor: '#123abc', defaultPrompt: 'Review this' }]);
    expect(await driver.listSkills(sdkAgent())).toMatchObject([{ brandColor: '#123abc', defaultPrompt: 'Review this' }]);
  });

  it('waits for a terminal plugin catalog and releases its pending subscription', async () => {
    const { driver, surface, emit } = setup();
    const snapshot = surface.getSnapshot();
    surface.getSnapshot.mockReturnValue({ ...snapshot, pluginCatalogStatus: 'loading' });
    const pending = driver.listPlugins(sdkAgent());
    await vi.waitFor(() => expect(surface.onEvent).toHaveBeenCalledTimes(2));
    const plugins = [{ id: 'plugin', name: 'plugin', displayName: 'Plugin', enabled: true }];
    emit({ seq: 1, origin: 'notification', occurredAt: metadata.occurredAt, type: 'catalog.pluginsChanged', payload: { plugins, status: 'loaded' } });
    await expect(pending).resolves.toStrictEqual(plugins);
  });

  it('projects provider context usage and account limits without deriving token counts itself', async () => {
    const { driver, conversation, events, emit } = setup();
    const contextUsage = { totalTokens: 500, inputTokens: 400, cachedInputTokens: 100, outputTokens: 80, reasoningOutputTokens: 20, lastTotalTokens: 50, modelContextWindow: 2000, usedPercent: 25 };
    conversation('conversation-a').setSnapshot({ contextUsage });
    await driver.loadConversation(sdkAgent());
    expect(events).toContainEqual(expect.objectContaining({ type: 'conversation.contextUsageUpdated', agentId: 'agent-a', payload: { contextUsage } }));
    events.length = 0;
    const updated = { ...contextUsage, usedPercent: 30 };
    conversation('conversation-a').emit({ ...metadata, type: 'conversation.contextUsageChanged', payload: { contextUsage: updated } });
    const rateLimits = { limitId: null, limitName: null, primary: { usedPercent: 85, windowDurationMins: 300, resetsAt: 123 }, secondary: null, credits: null, planType: null, individualLimit: null, rateLimitReachedType: null };
    emit({ seq: 1, origin: 'notification', occurredAt: metadata.occurredAt, type: 'rateLimits.changed', payload: { rateLimits: { rateLimits, rateLimitsByLimitId: null, rateLimitResetCredits: null } } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'conversation.contextUsageUpdated', agentId: 'agent-a', turnId: 'turn', payload: { contextUsage: updated } }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'account.rateLimitsUpdated', payload: { rateLimits } }));
  });

  it('closes the injected runtime owner once instead of independently closing its shared SDK', async () => {
    const closeRuntime = vi.fn(async () => undefined);
    const { driver, surface, conversation } = codexSdkFixture(closeRuntime);
    await driver.loadConversation(sdkAgent());
    await driver.close();
    await driver.close();
    expect(closeRuntime).toHaveBeenCalledOnce();
    expect(surface.close).not.toHaveBeenCalled();
    expect(conversation('conversation-a').listenerCount()).toBe(0);
  });
});
