import { describe, expect, it, vi } from 'vitest';
import type { AgentProviderDriver, BackendEvent } from '@workspace/core/provider-driver';
import { sessionError, turnCompleted, turnStarted } from './support/conversation-activity';
import type { HarnessProvider, RendererMessage } from '@workspace/core/contracts';
import { codexProviderCapabilities, claudeProviderCapabilities } from '@workspace/core/provider-capabilities';
import { AppBackendServer } from '../server';
import { ProviderDriverRpc } from '../driver-rpc';
import { DurableTaskService } from '../agents/durable-task-service';
import { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

function unfinishedTasks(parentAgentId: string, workerAgentId: string) {
  return new DurableTaskService({ tasks: [{ id: 'task', parentAgentId, workerAgentId, state: 'interrupted',
    requestId: 'request', requestFingerprint: 'fingerprint', provider: 'codex', assignment: { title: 'Inspect', doneWhen: 'Verified' },
    prompt: 'Inspect', attemptId: 'attempt', createdAt: '', updatedAt: '', parentWakeBlocked: false,
  }], save: async () => {}, agent: () => undefined, send: async () => { throw new Error('Unexpected prompt'); },
    interrupt: async () => {}, onError: error => { throw error; } });
}

it.each(['worker', 'parent'] as const)('blocks remote handoff for a %s with controller-owned unfinished tasks', async role => {
  const snapshot = createTestSnapshot();
  const connection = readyRemoteConnection();
  snapshot.remoteConnections.connections = [connection];
  snapshot.teams[0]!.remoteLinks = [{ connectionId: connection.id, remoteTeamId: 'team-remote' }];
  const agent = createRemoteAgent();
  const remote = createRemoteTeamSnapshot([agent]);
  const tasks = unfinishedTasks(role === 'parent' ? agent.id : 'parent', role === 'worker' ? agent.id : 'child');
  const request = vi.fn(async (_connection: unknown, method: string) => method === 'snapshot/get'
    ? { snapshot: remote, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } } : remote);
  const server = new AppBackendServer({ version: 'test', snapshot, tasks, remoteClients: { request, close: async () => {} } as never });
  try {
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/handoff/start', params: {
      agentId: agent.id, input: { operationId: 'once', selection: { provider: 'claude', model: null, reasoningEffort: null, serviceTier: null } },
    } })).rejects.toThrow('Resolve or cancel durable tasks');
    expect(request.mock.calls.map(([, method]) => method)).not.toContain('agent/handoff/start');
    expect(tasks.list(agent.id)[0]?.state).toBe('interrupted');
  } finally { tasks.close(); await server.close(); }
});

it('routes an ambiguous remote retry through the linked replacement without creating a local agent', async () => {
  const snapshot = createTestSnapshot();
  snapshot.remoteConnections.connections = [readyRemoteConnection()];
  snapshot.teams = [{ id: 'pointer', name: 'Remote', remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }], agentIds: [] }];
  const replacement = createRemoteAgent();
  replacement.handoff = { operationId: 'once', sourceAgentId: 'old-remote', sourceTitle: 'Source', sourceRef: { provider: 'codex', threadId: 'thread' }, targetAgentId: replacement.id, phase: 'complete', selection: {model: null, reasoningEffort: null, serviceTier: null,  provider: 'claude' } };
  const remoteSnapshot = createRemoteTeamSnapshot([replacement]);
  const remoteClients = {
    request: vi.fn().mockResolvedValueOnce({ snapshot: remoteSnapshot, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }).mockResolvedValue(remoteSnapshot),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const tasks = unfinishedTasks('old-remote', 'child');
  const server = new AppBackendServer({ version: 'test', snapshot, tasks, remoteClients: remoteClients as never });
  const params = { agentId: 'old-remote', input: { operationId: 'once', selection: { provider: 'claude', model: null, reasoningEffort: null, serviceTier: null } } };
  try {
    await server.handleMessage({ jsonrpc: '2.0', id: 'retry', method: 'agent/handoff/start', params });
    expect(remoteClients.request).toHaveBeenLastCalledWith(snapshot.remoteConnections.connections[0], 'agent/handoff/start', { ...params, _clientId: 'remote-controller' }, expect.any(Function));
    expect(snapshot.agents).toEqual([]);
  } finally { tasks.close(); await server.close(); }
});

describe.each(['codex', 'claude'] as const)('%s handoff routing', provider => {
  it('waits for the note and runtime release, rejects competing work, and preserves readable source history', async () => {
    const targetProvider: HarnessProvider = provider === 'codex' ? 'claude' : 'codex';
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'source', name: 'Worker', folder: '/repo', provider: provider, teamId: 'team-test', providerSession: provider === 'codex' ? { kind: 'codex', threadId: 'original' } : { kind: 'claude', sessionId: 'original', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' }];
    snapshot.teams[0]!.agentIds = ['source'];
    snapshot.activeAgentId = 'source';
    let sourceListener!: (event: BackendEvent) => void;
    let release!: () => void;
    const releaseGate = new Promise<void>(resolve => { release = resolve; });
    const sourceSend = vi.fn();
    const targetSend = vi.fn();
    const messages: RendererMessage[] = [{ id: 'note', agentId: 'source', turnId: 'note-turn', role: 'assistant', status: 'complete', parts: [{ type: 'text', text: 'Goal: continue the fix.' }], createdAt: '' }];
    const read = vi.fn(async () => messages);
    const archive = vi.fn(async () => undefined);
    const drivers = new Map<HarnessProvider, AgentProviderDriver>();
    for (const kind of [provider, targetProvider] as HarnessProvider[]) {
      drivers.set(kind, {
        provider: kind,
        getRuntimeStatus: () => ({ provider: kind, status: 'running' }),
        // Both sides archive here, so the test can watch the source being put away whichever harness it is.
        getCapabilities: () => ({ ...(kind === 'codex' ? codexProviderCapabilities : claudeProviderCapabilities), conversationArchive: true }),
        sendPrompt: async (agent, prompt) => {
          (agent.id === 'source' ? sourceSend : targetSend)(prompt);
          return { providerSession: kind === 'codex' ? { kind: 'codex', threadId: agent.id } : { kind: 'claude', sessionId: agent.id, transport: 'stdio' }, turnId: 'note-turn' };
        },
        readConversationMessages: read,
        archiveAgentConversation: archive,
        assertHandoffReady: async () => undefined,
        releaseConversation: () => releaseGate,
        interrupt: async () => ({ providerSession: { kind: 'codex', threadId: 'original' } }),
        respondToAgentRequest: async () => undefined,
        onEvent: listener => { if (kind === provider) sourceListener = listener; return () => undefined; },
        close: async () => undefined,
      });
    }
    const persisted: unknown[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new ProviderDriverRpc(drivers), saveSnapshot: async value => { persisted.push(structuredClone(value)); } });
    const params = { agentId: 'source', input: { operationId: 'once', selection: { provider: targetProvider, model: null, reasoningEffort: null, serviceTier: null } } };
    const operation = server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/handoff/start', params });
    await vi.waitFor(() => expect(sourceSend).toHaveBeenCalledOnce());
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'prompt', method: 'agent/prompt/send', params: { agentId: 'source', prompt: 'Competing work' } })).rejects.toThrow('handoff');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'move', method: 'agent/team/move', params: { input: { agentId: 'source', teamId: 'team-test' } } })).rejects.toThrow('handoff');
    sourceListener(turnCompleted('source', 'note-turn', { provider, ...(provider === 'codex' ? { conversationId: 'original' } : {}) }));
    sourceListener({ agentId: 'source', type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(archive).toHaveBeenCalledOnce());
    expect(targetSend).not.toHaveBeenCalled();
    release();
    await operation;
    expect(snapshot.agents).toHaveLength(1);
    const target = snapshot.agents[0]!;
    expect(target.provider).toBe(targetProvider);
    expect(target.handoff?.phase).toBe('complete');
    expect(targetSend).toHaveBeenCalledWith(expect.stringContaining('Goal: continue the fix.'));
    expect(persisted.length).toBeGreaterThan(2);
    await server.handleMessage({ jsonrpc: '2.0', id: 'retry', method: 'agent/handoff/start', params });
    expect(targetSend).toHaveBeenCalledOnce();
    await server.handleMessage({ jsonrpc: '2.0', id: 'history', method: 'agent/conversation/messages/get', params: { agentId: target.id, ref: target.handoff!.sourceRef } });
    expect(read).toHaveBeenCalledTimes(2);
    await server.close();
  });
});
