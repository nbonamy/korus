import { expect, it, vi } from 'vitest';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import { sessionError, turnCompleted, turnStarted } from './support/conversation-activity';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import { codexProviderCapabilities, defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { AppBackendServer } from '../server';
import { ProviderDriverRpc } from '../driver-rpc';
import { createTestSnapshot } from './server-test-fixtures';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';

it('does not retry startup continuation after an explicit Stop during writer backoff', async () => {
  vi.useFakeTimers();
  const snapshot = createTestSnapshot();
  snapshot.sourceFolder.initialized = true;
  const agent: Agent = { id: 'recovering', name: 'Recovering', teamId: 'team-test', folder: '/tmp', provider: 'codex',
    providerSession: { kind: 'codex', threadId: 'recovery' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' };
  snapshot.agents = [agent];
  const continued = vi.fn().mockRejectedValue(new Error('Codex app-server request timed out: thread/resume'));
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }),
    getCapabilities: () => codexProviderCapabilities, sendPrompt: async () => ({ providerSession: agent.providerSession! }),
    interrupt: async () => ({ providerSession: agent.providerSession! }), respondToAgentRequest: async () => {},
    continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(continued).toHaveBeenCalledOnce());
    await server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: 'agent/interrupt', params: { agentId: agent.id } });
    await vi.advanceTimersByTimeAsync(7500);
    await startup;
    expect(continued).toHaveBeenCalledOnce();
    expect(agent.status.type).toBe('idle');
    expect(agent.autoResumePending).toBeUndefined();
  } finally { await server.close(); vi.useRealTimers(); }
});

it('persists active work, clears a user stop, and resumes only marked agents after restart', async () => {
  const snapshot = createTestSnapshot();
  snapshot.sourceFolder.initialized = true;
  snapshot.providerConnections!.push({ provider: 'cursor', installed: true, connected: true, checking: false });
  const agents = (['codex', 'claude', 'cursor', 'stopped'] as const).map(id => ({
    id, name: id, folder: '/tmp', teamId: 'team-test', provider: id === 'codex' || id === 'cursor' ? id : 'claude',
    providerSession: id === 'codex' ? { kind: 'codex', threadId: id } : id === 'cursor' ? { kind: 'cursor', sessionId: id } : { kind: 'claude', sessionId: id, transport: 'stdio' },
    status: { type: 'idle' }, createdAt: '', updatedAt: '',
  } as Agent));
  snapshot.agents = agents;
  const continued = vi.fn(async (agent: Agent) => ({ providerSession: agent.providerSession!, activeTurnId: 'resumed' }));
  const driver = (provider: 'codex' | 'claude' | 'cursor'): AgentProviderDriver => ({
    provider: provider, getRuntimeStatus: () => ({ provider: provider, status: 'running' }), getCapabilities: () => defaultProviderCapabilities(provider),
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }),
    interrupt: async agent => {
      expect(stored?.agents.find(candidate => candidate.id === agent.id)?.autoResumePending).toBeUndefined();
      return { providerSession: agent.providerSession! };
    }, respondToAgentRequest: async () => {},
    continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {},
  });
  let stored: ReturnType<typeof persistedStateFromSnapshot> | undefined;
  const create = (state: AppSnapshot) => new AppBackendServer({ version: 'test', snapshot: state,
    saveSnapshot: async current => { stored = structuredClone(persistedStateFromSnapshot(current)); },
    driverRpc: new ProviderDriverRpc(new Map([['codex', driver('codex')], ['claude', driver('claude')], ['cursor', driver('cursor')]])) });
  const server = create(snapshot);
  try {
    for (const agent of agents) {
      await server.handleMessage({ jsonrpc: '2.0', id: agent.id, method: 'agent/prompt/send', params: { agentId: agent.id, prompt: 'work' } });
      server.emitEvent(turnStarted(agent.id, 'turn', { provider: agent.provider, conversationId: agent.id }));
    }
    await vi.waitFor(() => expect(stored?.agents.every(agent => (agent as Agent & { autoResumePending?: boolean }).autoResumePending)).toBe(true));
    await server.handleMessage({ jsonrpc: '2.0', id: 'stop', method: 'agent/interrupt', params: { agentId: 'stopped' } });
    expect((stored!.agents.find(agent => agent.id === 'stopped') as Agent & { autoResumePending?: boolean }).autoResumePending).not.toBe(true);
    const restored = snapshotFromPersistedState(JSON.parse(JSON.stringify(stored)));
    await server.close();
    const restarted = create(restored);
    try {
      await restarted.initialize();
      expect(continued.mock.calls.map(([agent]) => agent.id).sort()).toEqual(['claude', 'codex', 'cursor']);
    } finally { await restarted.close(); }
  } finally { await server.close(); }
});

it('keeps newer work marked when an older turn completes and does not recover completed work', async () => {
  const snapshot = createTestSnapshot();
  const agent: Agent = { id: 'a', name: 'a', folder: '/tmp', provider: 'claude', teamId: 'team-test',
    providerSession: { kind: 'claude', sessionId: 'session', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };
  snapshot.agents = [agent];
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {} });
  const emit = (turnId: string, started: boolean) => server.emitEvent(started ? turnStarted(agent.id, turnId, { provider: 'claude' }) : turnCompleted(agent.id, turnId, { provider: 'claude' }));
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
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', provider: 'codex', teamId: 'team-test',
    providerSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }), interrupt: async agent => ({ providerSession: agent.providerSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
  try { await server.initialize(); expect(continued).not.toHaveBeenCalled(); expect(snapshot.agents[0]!.autoResumePending).toBeUndefined(); }
  finally { await server.close(); }
});

it('reports a failed recovery and consumes it so a later startup does not send it again', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder.initialized = true;
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', provider: 'codex', teamId: 'team-test',
    providerSession: { kind: 'codex', threadId: 'thread' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }), interrupt: async agent => ({ providerSession: agent.providerSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: async () => { throw new Error('unavailable'); }, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
  try {
    await server.initialize();
    expect(snapshot.agents[0]!.autoResumePending).toBeUndefined();
    expect(snapshot.agents[0]!.status).toMatchObject({ type: 'error', message: expect.stringContaining('resume') });
  } finally { await server.close(); }
});

it('does not continue a replacement session selected while recovery is being saved', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder = { path: '/tmp', initialized: true, recentRepoNames: [] };
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', provider: 'codex', teamId: 'team-test',
    providerSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }), interrupt: async agent => ({ providerSession: agent.providerSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let savingRecovery = false;
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => {
    if (!value.agents[0]?.autoResumePending && !savingRecovery) { savingRecovery = true; await gate; }
  }, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(savingRecovery).toBe(true));
    snapshot.agents[0]!.providerSession = { kind: 'codex', threadId: 'replacement' };
    release(); await startup;
    expect(continued).not.toHaveBeenCalled();
  } finally { release(); await server.close(); }
});

it('does not replace newer active work with a recovery error', async () => {
  const snapshot = createTestSnapshot(); snapshot.sourceFolder = { path: '/tmp', initialized: true, recentRepoNames: [] };
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', provider: 'codex', teamId: 'team-test',
    providerSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  let rejectRecovery!: (error: Error) => void;
  const continuation = new Promise<never>((_, reject) => { rejectRecovery = reject; });
  const continued = vi.fn(() => continuation);
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }), interrupt: async agent => ({ providerSession: agent.providerSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async () => {}, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
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
  snapshot.agents = [{ id: 'a', name: 'a', folder: '/tmp', provider: 'codex', teamId: 'team-test',
    providerSession: { kind: 'codex', threadId: 'old' }, status: { type: 'idle' }, autoResumePending: true, createdAt: '', updatedAt: '' }];
  const continued = vi.fn();
  const driver: AgentProviderDriver = { provider: 'codex', getRuntimeStatus: () => ({ provider: 'codex', status: 'running' }), getCapabilities: () => codexProviderCapabilities,
    sendPrompt: async agent => ({ providerSession: agent.providerSession! }), interrupt: async agent => ({ providerSession: agent.providerSession! }),
    respondToAgentRequest: async () => {}, continueInterruptedTurn: continued, onEvent: () => () => {}, close: async () => {} };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saving = false;
  const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: async value => {
    if (!value.agents[0]?.autoResumePending && !saving) { saving = true; await gate; }
  }, driverRpc: new ProviderDriverRpc(new Map([['codex', driver]])) });
  try {
    const startup = server.initialize();
    await vi.waitFor(() => expect(saving).toBe(true));
    await server.close(); release(); await startup;
    expect(continued).not.toHaveBeenCalled();
  } finally { release(); await server.close(); }
});
