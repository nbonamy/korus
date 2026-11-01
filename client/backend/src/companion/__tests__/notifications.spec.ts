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
    for (const [name, expected] of [[null, 'korus - feature/notifications'], ['Builder', 'Builder']] as const) {
      const repository: CompanionWorkspace = { ...workspace, agents: [{ ...workspace.agents[0]!, name,
        workspace: { kind: 'git', folder: '/private', repositoryRoot: '/private', primaryWorktreeRoot: '/private', repositoryName: 'korus', branch: 'feature/notifications', isLinkedWorktree: false, updatedAt: '' },
      }] };
      expect(new CompanionNotifications('host').create(completed(), repository)?.name).toBe(expected);
    }
  });
  it('uses normalized requests for approval/question identity and handles Claude completion', () => {
    const source = new CompanionNotifications('host');
    const asyncQuestion = { type: 'agentRequest.created', agentId: 'agent', backend: 'codex', seq: 1, occurredAt: '', payload: { request: { id: 'async', conversationId: 'thread', kind: 'question', question: { itemId: 'async', delivery: 'async', blocking: false, questions: [] } } } } as AppBackendEvent;
    expect(source.accepts(asyncQuestion)).toBe(false);
    expect(source.create(asyncQuestion, workspace)).toBeNull();
    for (const kind of ['question', 'approval', 'toolConfirmation']) {
      const event = { type: 'agentRequest.created', agentId: 'agent', backend: 'codex', seq: 1, occurredAt: '', payload: { request: { id: kind, conversationId: 'thread', kind, question: { itemId: kind, delivery: 'tool', blocking: true, questions: [] } } } } as AppBackendEvent;
      expect(source.accepts(event)).toBe(true);
      expect(source.create(event, workspace)?.kind).toBe(kind === 'question' ? 'question' : 'approval');
      expect(source.create(event, workspace)).toBeNull();
    }
    const claude = { ...workspace, agents: [{ ...workspace.agents[0]!, backend: 'claude' as const, backendSession: { kind: 'claude' as const, sessionId: 'session', transport: 'stdio' as const } }] };
    const event = { type: 'claude.conversationEventReceived', agentId: 'agent', backend: 'claude', backendSessionId: 'session', payload: { revision: 1, event: { type: 'turn.completed', turnId: 'turn', payload: { turn: { id: 'turn', status: 'completed' } } } } } as AppBackendEvent;
    expect(source.create(event, claude)?.kind).toBe('completed');
  });
  describe('mission agents', () => {
    const base = workspace.agents[0]!;
    const worker = { ...base, id: 'worker', name: 'api', backendSession: { kind: 'codex' as const, threadId: 'worker-thread' } };
    const missionWorkspace: CompanionWorkspace = {
      ...workspace,
      missionAgents: [worker],
      missionProgress: [{ id: 'mission', teamId: 'team', outcome: 'Billing', stage: 'implementation', status: 'active', startedAt: '', updatedAt: '', revision: 1, leadAgentId: 'agent', tickets: [{ number: 1, title: 'api', state: 'running', agentId: 'worker' }] }],
    };
    const request = (agentId: string, conversationId: string): AppBackendEvent => ({ type: 'agentRequest.created', agentId, backend: 'codex', seq: 1, occurredAt: '', payload: { request: { id: `${agentId}-q`, conversationId, kind: 'question', question: { itemId: `${agentId}-q`, delivery: 'tool', blocking: true, questions: [] } } } }) as AppBackendEvent;
    const completedFor = (agentId: string, threadId: string): AppBackendEvent => ({ type: 'codex.conversationEventReceived', agentId, backend: 'codex', threadId, payload: { revision: 1, event: { type: 'turn.completed', conversationId: threadId, turnId: 'turn', payload: { status: 'completed' } } } }) as AppBackendEvent;

    it('asks the phone to step in when a repository worker or the lead needs input', () => {
      const source = new CompanionNotifications('host');
      expect(source.create(request('worker', 'worker-thread'), missionWorkspace)).toMatchObject({ kind: 'question', name: 'api', target: { agentId: 'worker' } });
      expect(source.create(request('agent', 'thread'), missionWorkspace)).toMatchObject({ kind: 'question', target: { agentId: 'agent' } });
    });

    it('stays quiet when a mission agent merely finishes a turn, because missions run on their own', () => {
      for (const status of ['active', 'completed'] as const) {
        const source = new CompanionNotifications('host');
        const current = { ...missionWorkspace, missionProgress: missionWorkspace.missionProgress!.map(mission => ({ ...mission, status })) };
        expect(source.create(completedFor('worker', 'worker-thread'), current)).toBeNull();
        expect(source.create(completedFor('agent', 'thread'), current)).toBeNull();
      }
    });

    it('still announces a finished turn for an agent that is not part of a mission', () => {
      const source = new CompanionNotifications('host');
      expect(source.create(completedFor('agent', 'thread'), { ...missionWorkspace, missionProgress: [] })?.kind).toBe('completed');
    });
  });
});
