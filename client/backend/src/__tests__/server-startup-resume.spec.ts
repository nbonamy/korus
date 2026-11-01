import { expect, it, vi } from 'vitest';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createTestSnapshot } from './server-test-fixtures';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';

it('persists active work, clears a user stop, and resumes only marked agents after restart', async () => {
  const snapshot = createTestSnapshot();
  snapshot.sourceFolder.initialized = true;
  const agents = (['codex', 'claude', 'stopped'] as const).map(id => ({
    id, name: id, folder: '/tmp', teamId: 'team-test', backend: id === 'codex' ? 'codex' : 'claude',
    backendSession: id === 'codex' ? { kind: 'codex', threadId: id } : { kind: 'claude', sessionId: id, transport: 'stdio' },
    status: { type: 'idle' }, createdAt: '', updatedAt: '',
  } as Agent));
  snapshot.agents = agents;
  const continued = vi.fn(async (agent: Agent) => ({ backendSession: agent.backendSession!, activeTurnId: 'resumed' }));
  const driver = (backend: 'codex' | 'claude'): AgentBackendDriver => ({
    backend, getRuntimeStatus: () => ({ backend, status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }),
    interrupt: async agent => {
      expect(stored?.agents.find(candidate => candidate.id === agent.id)?.autoResumePending).toBeUndefined();
      return { backendSession: agent.backendSession! };
    }, respondToAgentRequest: async () => {},
    continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {},
  });
  let stored: ReturnType<typeof persistedStateFromSnapshot> | undefined;
  const create = (state: AppSnapshot) => new AppBackendServer({ version: 'test', snapshot: state,
    saveSnapshot: async current => { stored = structuredClone(persistedStateFromSnapshot(current)); },
    driverRpc: new BackendDriverRpc(new Map([['codex', driver('codex')], ['claude', driver('claude')]])) });
  const server = create(snapshot);
  try {
    for (const agent of agents) {
      await server.handleMessage({ jsonrpc: '2.0', id: agent.id, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'work' } });
      if (agent.backend === 'codex') server.emitEvent({ agentId: agent.id, backend: 'codex', threadId: agent.id, type: 'codex.conversationEventReceived',
        payload: { revision: 1, event: { seq: 1, occurredAt: '', origin: 'notification', conversationId: agent.id, turnId: 'turn', type: 'turn.started', payload: { startedAt: '' } } } });
      else server.emitEvent({ agentId: agent.id, backend: 'claude', type: 'claude.conversationEventReceived',
        payload: { revision: 1, event: { backend: 'claude', agentId: agent.id, turnId: 'turn', type: 'turn.started', seq: 1, occurredAt: '', payload: { turn: { id: 'turn', backend: 'claude' } } } } });
    }
    await vi.waitFor(() => expect(stored?.agents.every(agent => (agent as Agent & { autoResumePending?: boolean }).autoResumePending)).toBe(true));
    await server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: 'agent/interrupt', params: { agentId: 'stopped' } });
    expect((stored!.agents.find(agent => agent.id === 'stopped') as Agent & { autoResumePending?: boolean }).autoResumePending).not.toBe(true);
    const restored = snapshotFromPersistedState(JSON.parse(JSON.stringify(stored)));
    await server.close();
    const restarted = create(restored);
    try {
      await restarted.initialize();
      expect(continued.mock.calls.map(([agent]) => agent.id).sort()).toEqual(['claude', 'codex']);
    } finally { await restarted.close(); }
  } finally { await server.close(); }
});

it('keeps newer work marked when an older turn completes and does not recover completed work', async () => {
  const snapshot = createTestSnapshot();
  const agent: Agent = { id: 'a', name: 'a', folder: '/tmp', backend: 'claude', teamId: 'team-test',
    backendSession: { kind: 'claude', sessionId: 'session', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };
  snapshot.agents = [agent];
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {} });
  const emit = (turnId: string, started: boolean) => server.emitEvent({ agentId: agent.id, backend: 'claude', type: 'claude.conversationEventReceived',
    payload: { revision: 1, event: started
      ? { backend: 'claude', agentId: agent.id, turnId, type: 'turn.started', seq: 1, occurredAt: '', payload: { turn: { id: turnId, backend: 'claude' } } }
      : { backend: 'claude', agentId: agent.id, turnId, type: 'turn.completed', seq: 2, occurredAt: '', payload: { turn: { id: turnId, status: 'completed' } } } } });
  try {
    emit('old', true); emit('new', true); emit('old', false);
    expect(agent.autoResumePending).toBe(true);
    emit('new', false);
    expect(agent.autoResumePending).toBeUndefined();
  } finally { await server.close(); }
});

it('does not resume work when startup recovery is disabled', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder.initialized = true;
  snapshot.general.autoResumeOnStartup = false;
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', backend: 'codex', teamId: 'team-test',
    backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }), interrupt: async agent => ({ backendSession: agent.backendSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  try { await server.initialize(); expect(continued).not.toHaveBeenCalled(); expect(snapshot.agents[0]!.autoResumePending).toBeUndefined(); }
  finally { await server.close(); }
});

it('reports a failed recovery and consumes it so a later startup does not send it again', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder.initialized = true;
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', backend: 'codex', teamId: 'team-test',
    backendSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }), interrupt: async agent => ({ backendSession: agent.backendSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: async () => { throw new Error('unavailable'); }, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  try {
    await server.initialize();
    expect(snapshot.agents[0]!.autoResumePending).toBeUndefined();
    expect(snapshot.agents[0]!.status).toMatchObject({ type: 'error', message: expect.stringContaining('resume') });
  } finally { await server.close(); }
});

it('does not continue a replacement session selected while recovery is being saved', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder = { path: '/tmp', initialized: true, recentRepoNames: [] };
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', backend: 'codex', teamId: 'team-test',
    backendSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }), interrupt: async agent => ({ backendSession: agent.backendSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let savingRecovery = false;
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => {
    if (!value.agents[0]?.autoResumePending && !savingRecovery) { savingRecovery = true; await gate; }
  }, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(savingRecovery).toBe(true));
    snapshot.agents[0]!.backendSession = { kind: 'codex', threadId: 'replacement' };
    release(); await startup;
    expect(continued).not.toHaveBeenCalled();
  } finally { release(); await server.close(); }
});

it('does not replace newer active work with a recovery error', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder = { path: '/tmp', initialized: true, recentRepoNames: [] };
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', backend: 'codex', teamId: 'team-test',
    backendSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  let rejectRecovery!: (error: Error) => void;
  const continuation = new Promise<never>((_, reject) => { rejectRecovery = reject; });
  const continued = vi.fn(() => continuation);
  const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }), interrupt: async agent => ({ backendSession: agent.backendSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(continued).toHaveBeenCalledOnce());
    snapshot.agents[0]!.status = { type: 'working' };
    snapshot.agents[0]!.autoResumePending = true;
    rejectRecovery(new Error('busy')); await startup;
    expect(snapshot.agents[0]!.status).toStrictEqual({ type: 'working' });
    expect(snapshot.agents[0]!.autoResumePending).toBe(true);
  } finally { rejectRecovery(new Error('closed')); await server.close(); }
});

it('does not start recovery after the daemon closes during the roster write', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder = { path: '/tmp', initialized: true, recentRepoNames: [] };
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', backend: 'codex', teamId: 'team-test',
    backendSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentBackendDriver = { backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }), getCapabilities: () => codexBackendCapabilities,
    sendPrompt: async agent => ({ backendSession: agent.backendSession! }), interrupt: async agent => ({ backendSession: agent.backendSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saving = false;
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => {
    if (!value.agents[0]?.autoResumePending && !saving) { saving = true; await gate; }
  }, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(saving).toBe(true));
    await server.close(); release(); await startup;
    expect(continued).not.toHaveBeenCalled();
  } finally { release(); await server.close(); }
});
