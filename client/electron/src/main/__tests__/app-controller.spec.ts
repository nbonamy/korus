import { describe, expect, it, vi } from 'vitest';
import { AppController, requiresSingleInstanceLock, shouldBlockDisplaySleep } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AddSshConnectionInput, AgentFilePreviewResult, AgentFileSearchItem, AppSnapshot, BackendConversationRef, BrowserState, ClientRequestResponse, CloneSourceRepositoryInput, CodexAuthentication, CodexChatGptLogin, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, ClientState, DevicePairingSession, DevicePairingStatus, DuplicateAgentOptions, Automation, AutomationLocation, MainToRendererEvent, MoveAgentToTeamInput, PairedDevice, RendererMessage, RendererSendPromptOptions, RendererSnapshotState, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, SetCodexResourceSharingInput, SourceFolderListInput, SourceRepository, SourceWorktree, SshHostCandidate, SystemPermissionsStatus, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkBacklogConfigurationInput, WorkItem, WorkProviderConnectResult, WorkProviderKind } from '@workspace/core/contracts';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels } from '@workspace/core/ipc';
import type { OpenInProvider } from '../open-in';
import { emitBackendEvent, setMainWindowSend, currentSnapshot, fakeAppLifecycle, createBackendClient } from './app-controller-test-harness';

describe('AppController', () => {

  it('starts and health-checks the configured backend process client', async () => {
    const snapshot = createInitialSnapshot();
    const backendClient = {
      start: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
      request: vi.fn().mockResolvedValue({}),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AppController(snapshot, backendClient);

    await controller.initialize();
    await controller.shutdown();

    expect(backendClient.start).toHaveBeenCalledOnce();
    expect(backendClient.health).toHaveBeenCalledOnce();
    expect(backendClient.close).toHaveBeenCalledOnce();
  });

  it('runs startup daemon maintenance before connecting to daemon', async () => {
    const order: string[] = [];
    const backendClient = createBackendClient();
    backendClient.start = vi.fn().mockImplementation(async () => {
      order.push('backend-start');
    });
    const startupMaintenance = vi.fn().mockImplementation(async () => {
      order.push('maintenance');
    });
    const controller = new AppController(createInitialSnapshot(), backendClient, fakeAppLifecycle(), startupMaintenance);

    await controller.initialize();

    expect(startupMaintenance).toHaveBeenCalledOnce();
    expect(order).toStrictEqual(['maintenance', 'backend-start']);
  });

  it('subscribes to daemon events before hydrating its startup snapshot', async () => {
    const initialSnapshot = createInitialSnapshot();
    const backendSnapshot = createInitialSnapshot();
    backendSnapshot.agents[0]!.status = { type: 'working' };
    const clientState: ClientState = {
      sourceFolderPath: '/Users/nbonamy/src',
      shouldPreventDisplaySleep: false,
    };
    let emitBackendEvent: ((event: AppBackendEvent) => void) | null = null;
    const backendClient: NonNullable<ConstructorParameters<typeof AppController>[1]> = {
      start: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
      request: <Result,>(method: string): Promise<Result> => {
        if (method === 'snapshot/get') {
          emitBackendEvent?.({
            seq: 18,
            backend: 'codex',
            agentId: 'agent-dina',
            type: 'agent.statusChanged',
            payload: { type: 'working' },
            occurredAt: '2026-06-13T00:00:00.000Z',
          });
          return Promise.resolve({ snapshot: backendSnapshot, lastEventSeq: 17, clientState } as Result);
        }
        return Promise.resolve({} as Result);
      },
      onEvent: vi.fn((listener) => {
        emitBackendEvent = listener;
        return () => undefined;
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new AppController(initialSnapshot, backendClient);
    const send = vi.fn();

    setMainWindowSend(controller, send);
    await controller.initialize();

    expect(send).toHaveBeenCalledWith(ipcChannels.event, expect.objectContaining({
      seq: 18,
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
    }));
    expect(currentSnapshot(controller)).toBe(backendSnapshot);
    expect(currentSnapshot(controller).agents[0]?.status).toStrictEqual({ type: 'working' });
  });
});
