import { describe, expect, it } from 'vitest';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import { CompanionNotifications } from '../notifications';

const workspace: CompanionWorkspace = { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', name: 'Builder', teamId: 'team', backend: 'codex', backendSession: { kind: 'codex', threadId: 'thread' }, folder: '/private', createdAt: '', updatedAt: '', status: { type: 'idle' } }] };
const completed = (status = 'completed'): AppBackendEvent => ({ type: 'codex.conversationEventReceived', agentId: 'agent', backend: 'codex', threadId: 'thread', payload: { revision: 1, event: { type: 'turn.completed', conversationId: 'thread', turnId: 'turn', payload: { status } } } }) as AppBackendEvent;

describe('companion attention events', () => {
  it('announces a completed turn once and never announces hydration, failed or stale turns', () => {
    const source = new CompanionNotifications('host');
    expect(source.create(completed('interrupted'), workspace)).toBeNull();
    expect(source.create(completed('failed'), workspace)).toBeNull();
    expect(source.create(completed(), { ...workspace, agents: [{ ...workspace.agents[0]!, backendSession: { kind: 'codex', threadId: 'new' } }] })).toBeNull();
    expect(source.create(completed(), { teams: [], agents: [] })).toBeNull();
    const result = source.create(completed(), workspace)!;
    expect(result).toStrictEqual({ id: expect.stringMatching(/^[a-f0-9]{64}$/), name: 'Builder', kind: 'completed', createdAt: expect.any(Number),
      target: { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: '{"kind":"codex","threadId":"thread"}' } });
    expect(source.create(completed(), workspace)).toBeNull();
    expect(source.accepts({ type: 'snapshot.updated', payload: {} } as AppBackendEvent)).toBe(false);
  });
  it('uses normalized requests for approval/question identity and handles Claude completion', () => {
    const source = new CompanionNotifications('host');
    for (const kind of ['question', 'approval', 'toolConfirmation']) {
      const event = { type: 'agentRequest.created', agentId: 'agent', payload: { request: { id: kind, conversationId: 'thread', kind } } } as AppBackendEvent;
      expect(source.accepts(event)).toBe(true);
      expect(source.create(event, workspace)?.kind).toBe(kind === 'question' ? 'question' : 'approval');
      expect(source.create(event, workspace)).toBeNull();
    }
    const claude = { ...workspace, agents: [{ ...workspace.agents[0]!, backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const } }] };
    const event = { type: 'claude.conversationEventReceived', agentId: 'agent', backend: 'claude', backendSessionId: 'session', payload: { revision: 1, event: { type: 'turn.completed', turnId: 'turn', payload: { turn: { id: 'turn', status: 'completed' } } } } } as AppBackendEvent;
    expect(source.create(event, claude)?.kind).toBe('completed');
  });
});
