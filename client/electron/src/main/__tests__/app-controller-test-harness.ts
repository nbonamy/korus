import { describe, expect, it, vi } from 'vitest';
import { AppController, requiresSingleInstanceLock, shouldBlockDisplaySleep } from '../app-controller';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { AddSshConnectionInput, AgentFilePreviewResult, AgentFileSearchItem, AppSnapshot, BackendConversationRef, BrowserState, ClientRequestResponse, CloneSourceRepositoryInput, CodexAuthentication, CodexChatGptLogin, ConversationSummary, CreateAgentInput, CreateAutomationInput, CreateQuickChatInput, CreateSourceWorktreeInput, CreateTeamInput, ClientState, DevicePairingSession, DevicePairingStatus, DuplicateAgentOptions, Automation, AutomationLocation, MainToRendererEvent, MoveAgentToTeamInput, PairedDevice, RendererMessage, RendererSendPromptOptions, RendererSnapshotState, ReorderAgentsInput, ReorderRepositoriesInput, ReorderTeamsInput, SetCodexResourceSharingInput, SourceFolderListInput, SourceRepository, SourceWorktree, SshHostCandidate, SystemPermissionsStatus, UpdateAgentInput, UpdateAutomationInput, UpdateRemoteConnectionInput, UpdateSettingsInput, UpdateTeamInput, WorkBacklogConfigurationInput, WorkItem, WorkProviderConnectResult, WorkProviderKind } from '@workspace/core/contracts';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/rpc';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { ipcChannels } from '@workspace/core/ipc';
import type { OpenInProvider } from '../open-in';

export function callPrivate<Result>(controller: AppController, method: string): Promise<Result> {
  return (controller as unknown as Record<string, () => Promise<Result>>)[method]!();
}

export function emitBackendEvent(
  controller: AppController,
  event: BackendEvent,
): void {
  const fullEvent: MainToRendererEvent = {
    ...event,
    seq: event.seq ?? 1,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  };
  (controller as unknown as {
    emitBackendEvent(event: AppBackendEvent): void;
  }).emitBackendEvent(fullEvent);
}

export function setMainWindowSend(controller: AppController, send: ReturnType<typeof vi.fn>): void {
  (controller as unknown as {
    mainWindow: { isDestroyed(): boolean; webContents: { send: ReturnType<typeof vi.fn> } };
  }).mainWindow = {
    isDestroyed: () => false,
    webContents: {
      send,
    },
  };
}

export function currentSnapshot(controller: AppController): AppSnapshot {
  return (controller as unknown as { snapshot: AppSnapshot }).snapshot;
}

export function fakeAppLifecycle() {
  return {
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  };
}

export function createBackendClient(overrides: {
  request?: unknown;
  onEvent?: unknown;
  close?: unknown;
  clientState?: ClientState;
} = {}): NonNullable<ConstructorParameters<typeof AppController>[1]> {
  const request = (overrides.request ?? vi.fn().mockResolvedValue({})) as (method: string, params?: unknown) => Promise<unknown>;
  const onEvent = (overrides.onEvent ?? vi.fn(() => () => undefined)) as (listener: (event: AppBackendEvent) => void) => () => void;
  const clientState = overrides.clientState ?? {
    sourceFolderPath: '',
    shouldPreventDisplaySleep: false,
  };
  return {
    start: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ ok: true, name: 'daemon', version: '0.1.0', pid: 123 }),
    request: <Result>(method: string, params?: unknown) => {
      if (method === 'snapshot/get') {
        return Promise.resolve({}) as Promise<Result>;
      }
      if (method === 'client/state/get') {
        return Promise.resolve(clientState) as Promise<Result>;
      }
      return request(method, params) as Promise<Result>;
    },
    onEvent,
    close: (overrides.close ?? vi.fn().mockResolvedValue(undefined)) as () => Promise<void>,
  };
}

export async function getSnapshot(controller: AppController): Promise<AppSnapshot> {
  return (controller as unknown as {
    getSnapshot(): Promise<AppSnapshot>;
  }).getSnapshot();
}


export async function updateSettings(controller: AppController, input: UpdateSettingsInput): Promise<AppSnapshot> {
  return (controller as unknown as {
    updateSettings(input: UpdateSettingsInput): Promise<AppSnapshot>;
  }).updateSettings(input);
}
