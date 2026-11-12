import { describe, expect, it } from 'vitest';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { CompanionWorkspace } from '@workspace/core/companion-protocol';
import { CompanionNotifications } from '../notifications';

const workspace: CompanionWorkspace = { teams: [{ id: 'team', name: 'Team', agentIds: ['agent'] }], agents: [{ id: 'agent', name: 'Builder', teamId: 'team', provider: 'codex', providerSession: { kind: 'codex', conversationId: 'thread' }, folder: '/private', createdAt: '', updatedAt: '', status: { type: 'idle' } }] };
const completed = (status = 'completed', conversationId = 'thread'): AppBackendEvent =>
  ({ type: 'turn.completed', agentId: 'agent', provider: 'codex', conversationId, turnId: 'turn', seq: 1, occurredAt: '', payload: { status, error: null, willRetry: false } }) as AppBackendEvent;

describe('companion attention events', () => {
  it('announces a completed turn once and never announces hydration, failed or stale turns', () => {
    const source = new CompanionNotifications('host');
    expect(source.create(completed('interrupted'), workspace)).toBeNull();
    expect(source.create(completed('failed'), workspace)).toBeNull();
    expect(source.create(completed(), { ...workspace, agents: [{ ...workspace.agents[0]!, providerSession: { kind: 'codex', conversationId: 'new' } }] })).toBeNull();
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
    const asyncQuestion = { type: 'agentRequest.created', agentId: 'agent', provider: 'codex', seq: 1, occurredAt: '', payload: { request: { id: 'async', conversationId: 'thread', kind: 'question', question: { itemId: 'async', delivery: 'async', blocking: false, questions: [] } } } } as AppBackendEvent;
    expect(source.accepts(asyncQuestion)).toBe(false);
    expect(source.create(asyncQuestion, workspace)).toBeNull();
    for (const kind of ['question', 'approval', 'toolConfirmation']) {
      const event = { type: 'agentRequest.created', agentId: 'agent', provider: 'codex', seq: 1, occurredAt: '', payload: { request: { id: kind, conversationId: 'thread', kind, question: { itemId: kind, delivery: 'tool', blocking: true, questions: [] } } } } as AppBackendEvent;
      expect(source.accepts(event)).toBe(true);
      expect(source.create(event, workspace)?.kind).toBe(kind === 'question' ? 'question' : 'approval');
      expect(source.create(event, workspace)).toBeNull();
    }
    const claude = { ...workspace, agents: [{ ...workspace.agents[0]!, provider: 'claude' as const, providerSession: { kind: 'claude' as const, conversationId: 'session', transport: 'stdio' as const } }] };
    expect(source.create(completed('completed', 'session'), claude)?.kind).toBe('completed');
  });
  it('pairs a finished turn with the read revision it caused, for local and remote agents alike', () => {
    const source = new CompanionNotifications('host');
    expect(source.capture(completed())).toStrictEqual([]);
    const [found] = source.capture({ type: 'agent.updated', agentId: 'agent', seq: 2, occurredAt: '', payload: { id: 'agent', readState: { revision: 3, readRevision: 2 } } } as AppBackendEvent);
    expect(found).toStrictEqual({ event: completed(), revision: 3 });
    expect(source.create(found!.event, workspace, found!.revision)?.kind).toBe('completed');
  });

  describe('mission agents', () => {
    const base = workspace.agents[0]!;
    const worker = { ...base, id: 'worker', name: 'api', providerSession: { kind: 'codex' as const, conversationId: 'worker-thread' } };
    const missionWorkspace: CompanionWorkspace = {
      ...workspace,
      missionAgents: [worker],
      missionProgress: [{ id: 'mission', teamId: 'team', outcome: 'Billing', stage: 'implementation', status: 'active', startedAt: '', updatedAt: '', revision: 1, leadAgentId: 'agent', tickets: [{ number: 1, title: 'api', state: 'running', agentId: 'worker' }] }],
    };
    const request = (agentId: string, conversationId: string): AppBackendEvent => ({ type: 'agentRequest.created', agentId, provider: 'codex', seq: 1, occurredAt: '', payload: { request: { id: `${agentId}-q`, conversationId, kind: 'question', question: { itemId: `${agentId}-q`, delivery: 'tool', blocking: true, questions: [] } } } }) as AppBackendEvent;
    const completedFor = (agentId: string, threadId: string): AppBackendEvent => ({ ...completed(), agentId, conversationId: threadId }) as AppBackendEvent;

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
