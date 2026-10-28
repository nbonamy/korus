import { describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import type { AgentBackend, RendererMessage } from '@workspace/core/contracts';
import { codexBackendCapabilities, claudeBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { createTestSnapshot, createRemoteAgent, createRemoteTeamSnapshot, readyRemoteConnection } from './server-test-fixtures';

it('routes an ambiguous remote retry through the linked replacement without creating a local agent', async () => {
  const snapshot = createTestSnapshot();
  snapshot.remoteConnections.connections = [readyRemoteConnection()];
  snapshot.teams = [{ id: 'pointer', name: 'Remote', remoteConnectionId: 'connection-devbox', remoteTeamId: 'team-remote', agentIds: [] }];
  const replacement = createRemoteAgent();
  replacement.handoff = { operationId: 'once', sourceAgentId: 'old-remote', sourceTitle: 'Source', sourceRef: { backend: 'codex', threadId: 'thread' }, targetAgentId: replacement.id, phase: 'complete', selection: {model: null, reasoningEffort: null, serviceTier: null,  backend: 'claude' } };
  const remoteSnapshot = createRemoteTeamSnapshot([replacement]);
  const remoteClients = {
    request: vi.fn().mockResolvedValueOnce({ snapshot: remoteSnapshot, lastEventSeq: 0, clientState: { sourceFolderPath: '', shouldPreventDisplaySleep: false } }).mockResolvedValue(remoteSnapshot),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });
  const params = { agentId: 'old-remote', input: { operationId: 'once', selection: { backend: 'claude', model: null, reasoningEffort: null, serviceTier: null } } };
  try {
    await server.handleMessage({ jsonrpc: '2.0', id: 'retry', method: 'agent/handoff/start', params });
    expect(remoteClients.request).toHaveBeenLastCalledWith(snapshot.remoteConnections.connections[0], 'agent/handoff/start', { ...params, _clientId: 'remote-controller' }, expect.any(Function));
    expect(snapshot.agents).toEqual([]);
  } finally { await server.close(); }
});

describe.each(['codex', 'claude'] as const)('%s handoff routing', backend => {
  it('waits for the note and runtime release, rejects competing work, and preserves readable source history', async () => {
    const targetBackend: AgentBackend = backend === 'codex' ? 'claude' : 'codex';
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'source', name: 'Worker', folder: '/repo', backend, teamId: 'team-test', backendSession: backend === 'codex' ? { kind: 'codex', threadId: 'original' } : { kind: 'claude', sessionId: 'original', transport: 'stdio' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' }];
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
    const drivers = new Map<AgentBackend, AgentBackendDriver>();
    for (const kind of [backend, targetBackend] as AgentBackend[]) {
      drivers.set(kind, {
        backend: kind,
        getRuntimeStatus: () => ({ backend: kind, status: 'running' }),
        getCapabilities: () => kind === 'codex' ? codexBackendCapabilities : claudeBackendCapabilities,
        sendPrompt: async (agent, prompt) => {
          (agent.id === 'source' ? sourceSend : targetSend)(prompt);
          return { backendSession: kind === 'codex' ? { kind: 'codex', threadId: agent.id } : { kind: 'claude', sessionId: agent.id, transport: 'stdio' }, turnId: 'note-turn' };
        },
        readConversationMessages: read,
        archiveAgentConversation: archive,
        assertHandoffReady: async () => undefined,
        releaseConversation: () => releaseGate,
        interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'original' } }),
        respondToAgentRequest: async () => undefined,
        onEvent: listener => { if (kind === backend) sourceListener = listener; return () => undefined; },
        close: async () => undefined,
      });
    }
    const persisted: unknown[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(drivers), saveSnapshot: async value => { persisted.push(structuredClone(value)); } });
    const params = { agentId: 'source', input: { operationId: 'once', selection: { backend: targetBackend, model: null, reasoningEffort: null, serviceTier: null } } };
    const operation = server.handleMessage({ jsonrpc: '2.0', id: 'handoff', method: 'agent/handoff/start', params });
    await vi.waitFor(() => expect(sourceSend).toHaveBeenCalledOnce());
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'prompt', method: 'agent/prompt/send', params: { agentId: 'source', prompt: 'Competing work' } })).rejects.toThrow('handoff');
    await expect(server.handleMessage({ jsonrpc: '2.0', id: 'move', method: 'agent/team/move', params: { input: { agentId: 'source', teamId: 'team-test' } } })).rejects.toThrow('handoff');
    sourceListener(backend === 'codex' ? {
      agentId: 'source', backend, threadId: 'original', type: 'codex.conversationEventReceived',
      payload: { revision: 1, event: { conversationId: 'original', origin: 'notification', turnId: 'note-turn', type: 'turn.completed', seq: 1, occurredAt: '', payload: { status: 'completed', error: null, willRetry: false, startedAt: null, completedAt: null, durationMs: null } } },
    } : {
      agentId: 'source', backend, type: 'claude.conversationEventReceived',
      payload: { revision: 1, event: { backend, agentId: 'source', turnId: 'note-turn', type: 'turn.completed', seq: 1, occurredAt: '', payload: { turn: { id: 'note-turn', status: 'completed' } } } },
    });
    sourceListener({ agentId: 'source', type: 'agent.statusChanged', payload: { type: 'idle' } });
    await vi.waitFor(() => expect(archive).toHaveBeenCalledOnce());
    expect(targetSend).not.toHaveBeenCalled();
    release();
    await operation;
    expect(snapshot.agents).toHaveLength(1);
    const target = snapshot.agents[0]!;
    expect(target.backend).toBe(targetBackend);
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
