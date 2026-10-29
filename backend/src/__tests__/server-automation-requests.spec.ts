import { describe, expect, it, vi } from 'vitest';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import {
  createTestSnapshot,
  readyRemoteConnection,
  createTextMessage,
} from './server-test-fixtures';

describe('AppBackendServer', () => {

  it('reads stored automation conversation messages after cleanup removes the agent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.automations = [{
      id: 'automation-bugs',
      name: 'GitHub bugs',
      enabled: true,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-test', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

      schedule: { intervalMinutes: 60 },
      executionLog: [{
        id: 'automation-exec-1',
        automationId: 'automation-bugs',
        startedAt: '2026-06-13T00:00:00.000Z',
        status: 'completed',
        completedAt: '2026-06-15T01:30:48.802Z',

        agentId: 'agent-cleaned-up', agentName: 'Cleaned Up', conversationRef: { backend: 'codex', threadId: 'thread-cleaned-up' },
      }],
    }];
    const messages = [createTextMessage('user-thread-cleaned-up-user-1', 'agent-cleaned-up', 'done')];
    const readConversationMessages = vi.fn().mockResolvedValue(messages);
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      readConversationMessages,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'messages',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-cleaned-up', ref: { backend: 'codex', threadId: 'thread-cleaned-up' } },
    })).resolves.toMatchObject({ result: messages });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'unknown-ref',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-cleaned-up', ref: { backend: 'codex', threadId: 'thread-unknown' } },
    })).resolves.toMatchObject({ error: { message: 'Conversation reference is not available.' } });

    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-cleaned-up' }, 'agent-cleaned-up');
    await server.close();
  });

  it('routes remote automation snapshots and mutations without adopting remote snapshot events', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const remoteSnapshot = createTestSnapshot();
    remoteSnapshot.activeTeamId = 'team-remote';
    remoteSnapshot.teams[0]!.id = 'team-remote';
    remoteSnapshot.automations = [{
      id: 'automation-remote',
      name: 'Remote bugs',
      enabled: true,
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-remote', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

      schedule: { intervalMinutes: 60 },
      executionLog: [],
      createdAt: '2026-06-14T10:00:00.000Z',
      updatedAt: '2026-06-14T10:00:00.000Z',
    }];
    const remoteClients = {
      request: vi.fn(async (_connection, method: string, _params, onEvent?: (event: unknown) => void) => {
        if (method === 'snapshot/get') {
          return {
            snapshot: remoteSnapshot,
            lastEventSeq: 12,
            clientState: {
              sourceFolderPath: '/home/nicolas/src',
              shouldPreventDisplaySleep: false,
            },
          };
        }
        onEvent?.({
          seq: 13,
          type: 'snapshot.updated',
          payload: remoteSnapshot,
          occurredAt: '2026-06-14T10:01:00.000Z',
          snapshot: remoteSnapshot,
        });
        return remoteSnapshot;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const events: unknown[] = [];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      onEvent: (event) => events.push(event),
      remoteClients: remoteClients as never,
    });
    const location = { kind: 'remote' as const, remoteConnectionId: 'connection-devbox' };
    const createInput = {
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-remote', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

      schedule: { intervalMinutes: 60 },
    };

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-snapshot',
      method: 'snapshot/automations/get',
      params: { location },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-create',
      method: 'automation/create',
      params: { input: createInput, location },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-backlog-configure',
      method: 'workProvider/backlog/configure',
      params: {
        input: { provider: 'github', configuration: { sourceId: 'nbonamy/agent-workspace' } },
        location,
      },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-update',
      method: 'automation/update',
      params: {
        input: {
          ...createInput,
          id: 'automation-remote',
          name: 'Remote regressions',
        },
        location,
      },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-run',
      method: 'automation/run',
      params: { automationId: 'automation-remote', location },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-history-clear',
      method: 'automation/history/clear',
      params: { automationId: 'automation-remote', location },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-execution-delete',
      method: 'automation/execution/delete',
      params: { automationId: 'automation-remote', executionId: 'automation-exec-1', location },
    })).resolves.toMatchObject({ result: remoteSnapshot });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-automation-delete',
      method: 'automation/delete',
      params: { automationId: 'automation-remote', location },
    })).resolves.toMatchObject({ result: remoteSnapshot });

    expect(remoteClients.request).toHaveBeenNthCalledWith(
      1,
      snapshot.remoteConnections.connections[0],
      'snapshot/get',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      2,
      snapshot.remoteConnections.connections[0],
      'automation/create',
      { ...{ input: createInput }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      3,
      snapshot.remoteConnections.connections[0],
      'workProvider/backlog/configure',
      { ...{ input: { provider: 'github', configuration: { sourceId: 'nbonamy/agent-workspace' } } }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      4,
      snapshot.remoteConnections.connections[0],
      'automation/update',
      { ...{
        input: {
          ...createInput,
          id: 'automation-remote',
          name: 'Remote regressions',
        },
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      5,
      snapshot.remoteConnections.connections[0],
      'automation/run',
      { ...{ automationId: 'automation-remote' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      6,
      snapshot.remoteConnections.connections[0],
      'automation/history/clear',
      { ...{ automationId: 'automation-remote' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      7,
      snapshot.remoteConnections.connections[0],
      'automation/execution/delete',
      { ...{ automationId: 'automation-remote', executionId: 'automation-exec-1' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(remoteClients.request).toHaveBeenNthCalledWith(
      8,
      snapshot.remoteConnections.connections[0],
      'automation/delete',
      { ...{ automationId: 'automation-remote' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.activeTeamId).toBe('team-test');
    expect(snapshot.automations).not.toContainEqual(expect.objectContaining({ id: 'automation-remote' }));
    expect(snapshot.providerConnections).toEqual(createTestSnapshot().providerConnections);
    await server.close();
  });

  it('owns automation mutations and automation runner dispatch', async () => {
    const snapshot = createTestSnapshot();
    const events: unknown[] = [];
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const automationRunner = {
      runAll: vi.fn().mockResolvedValue(undefined),
      runAutomation: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      automationRunner,
      onEvent: (event) => events.push(event),
    });
    const input = {
      name: 'GitHub bugs',
      enabled: true,
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-test', selection: { backend: 'codex' as const, model: null, reasoningEffort: null, serviceTier: null } },

      schedule: { intervalMinutes: 60 },
    };

    const created = await server.handleMessage({ jsonrpc: '2.0', id: 'create', method: 'automation/create', params: { input } });
    const automationId = snapshot.automations[0]?.id ?? '';
    expect(created).toMatchObject({ result: { automations: [{ name: 'GitHub bugs' }] } });
    expect(automationId).toBeTruthy();

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'update',
      method: 'automation/update',
      params: { input: { ...input, id: automationId, name: 'GitHub regressions' } },
    })).resolves.toMatchObject({ result: { automations: [{ name: 'GitHub regressions' }] } });

    snapshot.automations[0]?.executionLog.push({
      id: 'automation-exec-1',
      automationId,
      startedAt: '2026-06-13T00:00:00.000Z',
      status: 'completed',


    });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'delete-execution',
      method: 'automation/execution/delete',
      params: { automationId, executionId: 'automation-exec-1' },
    })).resolves.toMatchObject({ result: { automations: [{ executionLog: [] }] } });

    snapshot.automations[0]?.executionLog.push({
      id: 'automation-exec-2',
      automationId,
      startedAt: '2026-06-13T00:01:00.000Z',
      status: 'completed',


    });
    if (snapshot.automations[0]) {
      snapshot.automations[0].lastRunAt = '2026-06-13T00:01:00.000Z';
      snapshot.automations[0].lastError = 'GitHub failed';
    }
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'clear-history',
      method: 'automation/history/clear',
      params: { automationId },
    })).resolves.toMatchObject({ result: { automations: [{ executionLog: [] }] } });
    expect(snapshot.automations[0]?.lastRunAt).toBe('2026-06-13T00:01:00.000Z');
    expect(snapshot.automations[0]).not.toHaveProperty('lastError');

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'run',
      method: 'automation/run',
      params: { automationId },
    })).resolves.toMatchObject({ result: { automations: [{ id: automationId }] } });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'delete',
      method: 'automation/delete',
      params: { automationId },
    })).resolves.toMatchObject({ result: { automations: [] } });

    expect(automationRunner.runAutomation).toHaveBeenCalledWith(automationId);
    expect(saveSnapshot).toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'snapshot.updated' }),
    ]));
  });
});
