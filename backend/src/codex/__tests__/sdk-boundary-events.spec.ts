import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexConversationEvent } from '@codex-app-sdk/core/surface';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/events';
import { AppBackendServer } from '../../server';
import { BackendDriverRpc } from '../../driver-rpc';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { codexSdkFixture, sdkAgent } from './sdk-surface-fixture';

const metadata = { seq: 1, origin: 'notification' as const, occurredAt: '2026-09-16T00:00:00Z', conversationId: 'conversation-a', turnId: 'turn-a' };

describe(`Codex SDK → ${product.name} backend event contract`, () => {
  const fixtures: ReturnType<typeof codexSdkFixture>[] = [];
  const setup = () => { const fixture = codexSdkFixture(); fixtures.push(fixture); return fixture; };
  afterEach(async () => { await Promise.all(fixtures.splice(0).map(({ driver }) => driver.close())); });

  it('transports image references in snapshots and events and resolves bytes only for the current owning session', async () => {
    const { driver, conversation, events } = setup();
    const agent = sdkAgent();
    const bytes = Buffer.alloc(500_000, 123);
    Buffer.from('89504e470d0a1a0a0000000d494844520000064000000384', 'hex').copy(bytes);
    const image = 'data:image/png;base64,' + bytes.toString('base64');
    const message = { id: 'shot', role: 'assistant' as const, status: 'complete' as const, parts: [{ type: 'media' as const, media: { url: image, mimeType: 'image/png' } }] };
    conversation('conversation-a').setSnapshot({ messages: [message] });
    await driver.loadConversation(agent);
    const reset = events.find(event => event.type === 'codex.conversationSnapshotChanged')!;
    expect(JSON.stringify(reset).length).toBeLessThan(10_000);
    const reference = (reset as any).payload.snapshot.messages[0].parts[0].media.url as string;
    expect((reset as any).payload.snapshot.messages[0].parts[0].media).toMatchObject({width:1600,height:900});
    const contentId = reference.split(':').at(-1)!;
    const input = { sessionId: 'conversation-a', contentId, offset: 0 };
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await driver.readConversationContent(agent, input);
      chunks.push(Buffer.from(chunk.data, 'base64'));
      if (chunk.nextOffset === null) break;
      input.offset = chunk.nextOffset;
    }
    expect(Buffer.concat(chunks).toString()).toBe(image);
    conversation('conversation-a').emit({ ...metadata, type: 'conversation.historyPrepended', payload: { messages: [message] } });
    const live = events.filter(event => event.type === 'codex.conversationEventReceived').at(-1)!;
    expect(JSON.stringify(live)).toContain(reference);
    expect(JSON.stringify(live).length).toBeLessThan(10_000);
    await expect(driver.readConversationContent(sdkAgent('other'), input)).rejects.toThrow();
    await expect(driver.readConversationContent(agent, { ...input, sessionId: 'other' })).rejects.toThrow();
    conversation('conversation-a').setSnapshot({ messages: [] });
    await expect(driver.readConversationContent(agent, input)).rejects.toThrow();
  });

  it('projects an SDK completed plan through the real driver and server into durable review state', async () => {
    const { driver, conversation } = setup();
    const snapshot = createTestSnapshot();
    const agent = { ...sdkAgent(), teamId: 'team-test' };
    snapshot.agents = [agent];
    snapshot.teams[0]!.agentIds = [agent.id];
    const events: AppBackendEvent[] = [];
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), onEvent: (event) => events.push(event),
    });
    try {
      await driver.loadConversation(agent);
      conversation('conversation-a').emit({ ...metadata, type: 'plan.updated', payload: { explanation: null, steps: [{ step: 'Inspect', status: 'inProgress' }], markdown: '- Inspect', status: 'running' } });
      expect(events).toContainEqual(expect.objectContaining({ type: 'codex.conversationEventReceived', payload: expect.objectContaining({ event: expect.objectContaining({ type: 'plan.updated' }) }) }));
      expect(snapshot.agents[0]!.planReview).toBeUndefined();
      expect(events.filter((event) => event.type === 'plan.readyForReview')).toStrictEqual([]);
      conversation('conversation-a').emit({ ...metadata, type: 'plan.completed', payload: { itemId: 'proposal', markdown: '# Ship safely\n\nRun the tests.' } });
      expect(events.filter((event) => event.type === 'plan.readyForReview')).toMatchObject([{
        agentId: agent.id, conversationId: 'conversation-a', turnId: 'turn-a',
        payload: { itemId: 'proposal', markdown: '# Ship safely\n\nRun the tests.' },
      }]);
      expect(snapshot.agents[0]!.planReview).toMatchObject({ status: 'pending', markdown: '# Ship safely\n\nRun the tests.' });
      conversation('conversation-a').emit({ ...metadata, seq: 2, type: 'plan.completed', payload: { itemId: 'proposal', markdown: '# Ship safely\n\nRun the tests.' } });
      expect(events.filter((event) => event.type === 'plan.readyForReview')).toHaveLength(1);
      await server.handleMessage({ jsonrpc: '2.0', id: 'cancel', method: 'agent/planReview/respond', params: { agentId: agent.id, response: { reviewId: snapshot.agents[0]!.planReview!.id, resolution: 'cancel' } } });
      expect(snapshot.agents[0]!.planReview!.status).toBe('cancel');
      conversation('conversation-a').emit({ ...metadata, seq: 3, type: 'plan.completed', payload: { itemId: 'proposal', markdown: 'replayed' } });
      expect(events.filter((event) => event.type === 'plan.readyForReview')).toHaveLength(1);
      conversation('conversation-a').emit({ ...metadata, seq: 4, type: 'plan.completed', payload: { itemId: 'new-proposal', markdown: '# Revised proposal' } });
      const accepted = await server.handleMessage({ jsonrpc: '2.0', id: 'accept', method: 'agent/planReview/respond', params: { agentId: agent.id, response: { reviewId: snapshot.agents[0]!.planReview!.id, resolution: 'accept' } } });
      expect(accepted).not.toHaveProperty('error');
      expect(snapshot.agents[0]!.planReview!.status).toBe('accept');
      expect(conversation('conversation-a').handle.sendMessage).toHaveBeenCalledExactlyOnceWith('implement the plan', expect.objectContaining({ planMode: false }));
      snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'replacement' };
      conversation('conversation-a').emit({ ...metadata, seq: 4, type: 'plan.completed', payload: { itemId: 'late-proposal', markdown: 'obsolete' } });
      expect(events.filter((event) => event.type === 'plan.readyForReview')).toHaveLength(2);
      expect(events.map((event) => event.type)).not.toContain('sidePanel.markdownRequested');
    } finally { await server.close(); }
  });

  it.each([
    { type: 'plan.completed', payload: { itemId: 'opaque-item', markdown: 'unchanged' } },
    { type: 'turn.error', payload: { error: { message: 'Reconnecting 3/5', additionalDetails: null, codexErrorInfo: null }, willRetry: true } },
    { type: 'conversation.historyPrepended', payload: { messages: [{ id: 'older', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'unchanged history' }], createdAt: '2026-09-15T00:00:00Z' }] } },
  ] satisfies Array<Pick<CodexConversationEvent, 'type' | 'payload'>>)('retains opaque $type events and independent revisions', async (input) => {
    const { driver, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    await driver.loadConversation(sdkAgent('agent-b', 'conversation-b'));
    events.length = 0;
    const event = { ...metadata, ...input } as CodexConversationEvent;
    conversation('conversation-a').emit(event);
    conversation('conversation-b').emit({ ...event, conversationId: 'conversation-b' });
    const frames = events.filter((value) => value.type === 'codex.conversationEventReceived');
    expect(frames).toMatchObject([
      { agentId: 'agent-a', payload: { revision: 2, event } },
      { agentId: 'agent-b', payload: { revision: 2, event: { ...event, conversationId: 'conversation-b' } } },
    ]);
    expect(events.filter((value) => !value.type.startsWith('codex.'))).toStrictEqual([]);
  });

  it('maps SDK settings including explicitly disabled fast mode into provider-neutral settings', async () => {
    const { driver, conversation, events } = setup();
    await driver.loadConversation(sdkAgent());
    events.length = 0;
    conversation('conversation-a').emit({ ...metadata, type: 'conversation.settingsChanged', payload: { approvalPreset: 'full-access', selectedModelId: 'model', selectedReasoningEffort: 'high', selectedServiceTier: null, planMode: false } });
    expect(events.filter((event) => event.type === 'conversation.settingsUpdated')).toMatchObject([{
      agentId: 'agent-a', conversationId: 'conversation-a', payload: { settings: { approvalPreset: 'full-access', model: 'model', reasoningEffort: 'high', serviceTier: null } },
    }]);
    expect(events.filter((event) => event.type === 'conversation.modeUpdated')).toMatchObject([{ payload: { mode: 'default' } }]);
  });

  it.each(['approval', 'question'] as const)('routes colliding %s IDs through the real driver to the owning SDK handle', async (kind) => {
    const { driver, conversation, surface } = setup();
    for (const suffix of ['a', 'b']) {
      const id = `conversation-${suffix}`;
      conversation(id).setSnapshot({
        approvals: kind === 'approval' ? [{ id: '0', conversationId: id, itemId: 'item', kind: 'command', title: 'Run', canDeny: true, allowedScopes: ['once'] }] : [],
        clientRequests: kind === 'question' ? [{ id: '0', conversationId: id, turnId: 'turn', itemId: 'item', kind: 'ask_user', payload: { request: { itemId: 'item', delivery: 'async', blocking: false, questions: [] } } }] : [],
      });
      await driver.loadConversation(sdkAgent(`agent-${suffix}`, id));
    }
    const outcome = kind === 'approval' ? { kind: 'decision' as const, decision: 'allow' as const } : { kind: 'answered' as const, answers: {} };
    await expect(driver.respondToAgentRequest({ id: '0', outcome })).rejects.toThrow('Agent identity');
    await expect(driver.respondToAgentRequest({ agentId: 'missing', id: '0', outcome })).rejects.toThrow('no longer pending');
    await driver.respondToAgentRequest({ agentId: 'agent-b', id: '0', outcome });
    const a = conversation('conversation-a').handle;
    const b = conversation('conversation-b').handle;
    expect(a.resolveApproval).not.toHaveBeenCalled();
    expect(a.respondToClientRequest).not.toHaveBeenCalled();
    if (kind === 'approval') expect(b.resolveApproval).toHaveBeenCalledWith('0', 'approve', 'once');
    else expect(b.respondToClientRequest).toHaveBeenCalledWith({ id: '0', payload: { answers: {} } });
    expect(surface.respondToClientRequest).not.toHaveBeenCalled();
  });

  it('does not mark a read approval unread again when loading the conversation', async () => {
    const { driver, conversation } = setup();
    const snapshot = createTestSnapshot();
    const agent = sdkAgent();
    snapshot.agents = [agent];
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });
    const approval = { id: 'approval-1', conversationId: 'conversation-a', itemId: 'item', kind: 'command' as const, title: 'Run', canDeny: true, allowedScopes: ['once' as const] };
    try {
      conversation('conversation-a').setSnapshot({ approvals: [approval] });
      await driver.loadConversation(agent);
      const revision = snapshot.agents[0]!.readState!.revision;
      await server.handleMessage({ jsonrpc: '2.0', id: 'read', method: 'agent/read', params: { agentId: agent.id, revision } });
      await driver.loadConversation(agent);
      await driver.loadConversation(agent);
      expect(snapshot.agents[0]!.readState).toStrictEqual({ revision, readRevision: revision });
      expect(snapshot.agentRequests?.[agent.id]?.map(request => request.id)).toStrictEqual(['approval-1']);

      conversation('conversation-a').setSnapshot({ approvals: [approval, { ...approval, id: 'approval-2' }] });
      await driver.loadConversation(agent);
      expect(snapshot.agents[0]!.readState).toStrictEqual({ revision: revision + 1, readRevision: revision });
      expect(snapshot.agentRequests?.[agent.id]?.map(request => request.id)).toStrictEqual(['approval-1', 'approval-2']);
    } finally { await server.close(); }
  });

  it('reconciles SDK question snapshots and responses without retaining lifecycle metadata', async () => {
    const { driver, conversation } = setup();
    const snapshot = createTestSnapshot();
    const agents = [sdkAgent(), sdkAgent('agent-b', 'conversation-b')];
    snapshot.agents = agents;
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });
    const request = {
      id: 'async-question:shared-id', conversationId: 'conversation-a', turnId: 'turn-a',
      itemId: 'shared-id', kind: 'ask_user' as const,
      payload: { request: { itemId: 'shared-id', delivery: 'async' as const, blocking: false, questions: [] } },
    };
    const pendingAgents = () => Object.entries(snapshot.agentRequests ?? {}).filter(([, requests]) => requests.length > 0).map(([id]) => id);
    try {
      for (const agent of agents) {
        const id = agent.backendSession!.kind === 'codex' ? agent.backendSession!.threadId : '';
        conversation(id).setSnapshot({ clientRequests: [{ ...request, conversationId: id }] });
        await driver.loadConversation(agent);
      }
      expect(pendingAgents()).toStrictEqual(['agent-a', 'agent-b']);
      // The authoritative snapshot has dropped the question, but its resolution event was missed.
      conversation('conversation-a').setSnapshot({ clientRequests: [] });
      await driver.loadConversation(agents[0]!);
      expect(pendingAgents()).toStrictEqual(['agent-b']);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'stale', method: 'agent/request/respond',
        params: { response: { agentId: 'agent-a', id: request.id, outcome: { kind: 'cancelled' } } },
      })).rejects.toThrow('no longer pending');
      expect(conversation('conversation-a').handle.respondToClientRequest).not.toHaveBeenCalled();

      // Snapshot-only discovery must also expose new requests when their creation event was missed.
      conversation('conversation-a').setSnapshot({ clientRequests: [request] });
      await driver.loadConversation(agents[0]!);
      expect(pendingAgents()).toStrictEqual(['agent-a', 'agent-b']);
      conversation('conversation-a').handle.respondToClientRequest.mockImplementation(async () => {
        conversation('conversation-a').setSnapshot({ clientRequests: [], answeredClientRequestIds: [request.id] });
        return conversation('conversation-a').handle.getSnapshot();
      });
      const skipped = await server.handleMessage({ jsonrpc: '2.0', id: 'skip', method: 'agent/request/respond',
        params: { response: { agentId: 'agent-a', id: request.id, outcome: { kind: 'cancelled' } } },
      });
      expect(skipped).not.toHaveProperty('error');
      expect(pendingAgents()).toStrictEqual(['agent-b']);
      await driver.loadConversation(agents[0]!);
      expect(pendingAgents()).toStrictEqual(['agent-b']);
      conversation('conversation-a').setSnapshot({ clientRequests: [request] });
      await driver.loadConversation(agents[0]!);
      conversation('conversation-a').handle.respondToClientRequest.mockImplementation(async () => {
        conversation('conversation-a').setSnapshot({ clientRequests: [], answeredClientRequestIds: [request.id] });
        throw new Error('Unknown client request');
      });
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'resolved-elsewhere', method: 'agent/request/respond',
        params: { response: { agentId: 'agent-a', id: request.id, outcome: { kind: 'answered', answers: {} } } },
      })).rejects.toThrow('Unknown client request');
      expect(pendingAgents()).toStrictEqual(['agent-b']);
    } finally { await server.close(); }
  });

  it('routes a projected async question when its request event was missed', async () => {
    const { driver, conversation, surface } = setup();
    await driver.loadConversation(sdkAgent());
    const request = {
      id: 'async-question:question-1', conversationId: 'conversation-a', turnId: 'turn-a',
      itemId: 'question-1', kind: 'ask_user' as const,
      payload: { request: { itemId: 'question-1', delivery: 'async' as const, blocking: false,
        questions: [{ id: 'choice', header: 'Choice', question: 'Which one?', isOther: false, isSecret: false, options: null }],
      } },
    };
    conversation('conversation-a').setSnapshot({
      activeTurnId: null,
      clientRequests: [request],
      messages: [{ id: 'question-message', role: 'assistant', status: 'complete', turnId: 'turn-a',
        parts: [{ type: 'question', request }] }],
    });
    conversation('conversation-a').emit({ ...metadata, type: 'message.appended', payload: {
      message: { id: 'question-message', role: 'assistant', status: 'complete', turnId: 'turn-a',
        parts: [{ type: 'question', request }] },
    } });

    await driver.respondToAgentRequest({ agentId: 'agent-a', id: request.id,
      outcome: { kind: 'answered', answers: { choice: { answers: ['First'] } } } });

    expect(conversation('conversation-a').handle.respondToClientRequest).toHaveBeenCalledExactlyOnceWith({
      id: request.id, payload: { answers: { choice: { answers: ['First'] } } },
    });
    expect(surface.respondToClientRequest).not.toHaveBeenCalled();
  });
});
