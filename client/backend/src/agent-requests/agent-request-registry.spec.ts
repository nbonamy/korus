import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AgentBackend, MainToRendererEvent } from '@workspace/core/contracts';
import { AgentRequestRegistry } from './agent-request-registry';
import { approvalAgentRequest } from '@workspace/core/agent-request';

function setup(backend: AgentBackend = 'codex', remoteConnectionId: string | null = null) {
  const snapshot = createInitialSnapshot();
  snapshot.agents[0]!.backend = backend;
  const registry = new AgentRequestRegistry({ getSnapshot: () => snapshot, remoteConnectionIdForAgent: () => remoteConnectionId });
  const event: MainToRendererEvent = {
    seq: 1, occurredAt: '2026-09-16T00:00:00Z', agentId: 'agent-dina', backend,
    type: 'agentRequest.created', payload: { request: {
      id: '0', conversationId: 'conversation-1', turnId: 'turn-1', kind: 'question',
      question: { itemId: 'question-1', delivery: 'async', blocking: false, questions: [] },
    } },
  };
  registry.record(event);
  return { registry, event };
}

describe('AgentRequestRegistry', () => {
  it('validates approval and confirmation scopes before invoking a provider', async () => {
    const { registry, event } = setup();
    const send = vi.fn().mockResolvedValue(undefined);
    registry.record({ ...event, payload: { request: approvalAgentRequest({ id: '0', itemId: 'item', kind: 'command', conversationId: 'c', title: 'Approve', canDeny: false, allowedScopes: ['session'] }) } });
    for (const decision of ['deny', 'always_allow', 'allow'] as const) {
      await expect(registry.respond({ id: '0', outcome: { kind: 'decision', decision } }, send)).rejects.toThrow();
    }
    await expect(registry.respond({ id: '0', outcome: { kind: 'answered', answers: {} } }, send)).rejects.toThrow('request kind');
    expect(send).not.toHaveBeenCalled();
    await registry.respond({ id: '0', outcome: { kind: 'decision', decision: 'allow_conversation' } }, send);
    registry.record({ ...event, payload: { request: {
      id: '0', conversationId: 'c', kind: 'toolConfirmation' as const, confirmation: { integrationId: 'test', integrationName: 'Test', toolName: 'Bash', summary: 'Run', argumentsPreview: '{}', allowAlways: false, allowConversation: false },
    } } });
    for (const decision of ['always_allow', 'allow_conversation'] as const) await expect(registry.respond({ id: '0', outcome: { kind: 'decision', decision } }, send)).rejects.toThrow('scope');
    await registry.respond({ id: '0', outcome: { kind: 'decision', decision: 'deny' } }, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps a replacement request when an older submission or resolution completes', async () => {
    const { registry, event } = setup();
    let accepted!: () => void;
    const first = registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, () => new Promise<void>((resolve) => { accepted = resolve; }));
    registry.record({ type: 'agent.conversationAttached', agentId: 'agent-dina', backend: 'codex', conversationId: 'next', payload: {}, seq: 2, occurredAt: 'now' });
    registry.record({ ...event, payload: { request: { ...event.payload.request, conversationId: 'next' } } });
    accepted();
    await first;
    registry.record({ type: 'agentRequest.resolved', agentId: 'agent-dina', backend: 'codex', conversationId: 'conversation-1', payload: { id: '0', outcome: { kind: 'completed' } }, seq: 3, occurredAt: 'now' });
    expect(registry.owner('0')).toBeDefined();
    await registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, async () => undefined);
    expect(registry.owner('0')).toBeUndefined();
  });
  it.each(['codex', 'claude'] as const)('routes normalized %s requests including ID zero without inspecting provider frames', async (backend) => {
    const { registry } = setup(backend, 'devbox');
    const send = vi.fn().mockResolvedValue(undefined);
    await registry.respond({ id: '0', outcome: { kind: 'answered', answers: {} } }, send);
    expect(send).toHaveBeenCalledWith({ kind: 'driver', backend, remoteConnectionId: 'devbox' });
    expect(registry.owner('0')).toBeUndefined();
    await expect(registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, send)).rejects.toThrow('no longer pending');
  });

  it('rejects mismatched responses, prevents concurrent submissions, and permits retry after failure', async () => {
    const { registry } = setup();
    const send = vi.fn();
    await expect(registry.respond({ id: '0', outcome: { kind: 'decision', decision: 'allow' } }, send)).rejects.toThrow('request kind');
    expect(send).not.toHaveBeenCalled();
    let reject!: (reason: Error) => void;
    send.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
    const first = registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, send);
    await expect(registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, send)).rejects.toThrow('already being submitted');
    reject(new Error('transport unavailable'));
    await expect(first).rejects.toThrow('transport unavailable');
    send.mockResolvedValue(undefined);
    await registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('invalidates handles on resolution and conversation release', () => {
    const { registry, event } = setup();
    registry.record({ seq: 2, occurredAt: event.occurredAt, agentId: 'agent-dina', backend: 'codex', type: 'agentRequest.resolved', payload: { id: '0', outcome: { kind: 'cancelled' } } });
    expect(registry.owner('0')).toBeUndefined();
    registry.record(event);
    registry.clearAgent('agent-dina');
    expect(registry.owner('0')).toBeUndefined();
  });

  it('requires a target when two agents have the same provider request ID', async () => {
    const { registry, event } = setup();
    registry.record({ ...event, agentId: 'agent-other', backend: 'claude' });
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(registry.respond({ id: '0', outcome: { kind: 'cancelled' } }, send)).rejects.toThrow('Agent identity is required');
    expect(send).not.toHaveBeenCalled();
    await registry.respond({ agentId: 'agent-other', id: '0', outcome: { kind: 'cancelled' } }, send);
    expect(send).toHaveBeenCalledWith({ kind: 'driver', backend: 'claude' });
    expect(registry.owner('0')).toStrictEqual({ kind: 'driver', backend: 'codex' });
  });
});
