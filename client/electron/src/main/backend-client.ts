import type { AppBackendEvent, AppBackendHealth } from '@workspace/core/backend-protocol/rpc';
import { createRuntimeClientRequestHandlers } from './client-request-handlers';
import { AppBackendProcessClient } from './backend-process-client';
import { AppBackendSocketClient } from './backend-socket-client';
import { warnMain } from './log';
import { runtimeDaemonBackendMode, runtimeDaemonCommand, runtimeDaemonSocketPath, runtimeDaemonWatchFile } from './runtime-config';
import type { SpokenAnnouncementQueue } from './spoken-announcements';
import type { SpokenAnnouncementVoice } from '@workspace/core/contracts';

export type AppBackendClientPort = {
  close(): Promise<void>;
  health(): Promise<AppBackendHealth>;
  onConnectionState?(listener: (state: 'connected' | 'disconnected', error?: Error) => void): () => void;
  onEvent(listener: (event: AppBackendEvent) => void): () => void;
  request<Result>(method: string, params?: unknown): Promise<Result>;
  start(): Promise<void>;
};

export function createRuntimeAppBackendClient(options: {
  mobileSimulator?: (agentId: string, input: import('@workspace/core/mobile-simulator').MobileRequest) => Promise<import('@workspace/core/mobile-simulator').MobileResult>;
  browserOpen?: (agentId: string, browserId: string, url: string) => Promise<unknown>;
  browserExecute?: (agentId: string, browserId: string, command: string, arguments_: Record<string, unknown>) => Promise<unknown>;
  spokenAnnouncements?: Pick<SpokenAnnouncementQueue, 'queue'>;
  spokenAnnouncementVoice?: () => SpokenAnnouncementVoice;
} = {}): AppBackendClientPort | null {
  const mode = runtimeDaemonBackendMode();
  const requestHandlers = createRuntimeClientRequestHandlers({
    mobileSimulator: options.mobileSimulator,
    browserExecute: options.browserExecute,
    browserOpen: options.browserOpen,
    spokenAnnouncements: options.spokenAnnouncements,
    spokenAnnouncementVoice: options.spokenAnnouncementVoice,
  });
  const socketClient = new AppBackendSocketClient({
    socketPath: runtimeDaemonSocketPath(),
    requestHandlers,
  });

  if (mode === 'existing') {
    return socketClient;
  }

  const command = runtimeDaemonCommand();
  const processClient = command ? new AppBackendProcessClient({
    command,
    requestHandlers,
    watchFile: runtimeDaemonWatchFile(),
  }) : null;

  if (mode === 'bundled') {
    return processClient;
  }

  return processClient ? new AutoAppBackendClient(socketClient, processClient) : socketClient;
}

class AutoAppBackendClient implements AppBackendClientPort {
  private active: AppBackendClientPort | null = null;

  constructor(
    private readonly socketClient: AppBackendClientPort,
    private readonly processClient: AppBackendClientPort,
  ) {}

  async start(): Promise<void> {
    if (this.active) {
      await this.active.start();
      await this.active.health();
      return;
    }

    try {
      await this.socketClient.start();
      await this.socketClient.health();
      this.active = this.socketClient;
    } catch (error) {
      await this.socketClient.close();
      warnMain('daemon', 'local daemon unavailable, starting bundled backend', {
        detail: error instanceof Error ? error.message : String(error),
      });
      await this.processClient.start();
      this.active = this.processClient;
    }
  }

  async health(): Promise<AppBackendHealth> {
    return this.requireActive().health();
  }

  request<Result>(method: string, params?: unknown): Promise<Result> {
    return this.requireActive().request(method, params);
  }

  onEvent(listener: (event: AppBackendEvent) => void): () => void {
    return this.requireActive().onEvent(listener);
  }

  onConnectionState(listener: (state: 'connected' | 'disconnected', error?: Error) => void): () => void {
    return this.requireActive().onConnectionState?.(listener) ?? (() => undefined);
  }

  async close(): Promise<void> {
    await this.active?.close();
    this.active = null;
  }

  private requireActive(): AppBackendClientPort {
    if (!this.active) {
      throw new Error('daemon backend is not connected.');
    }
    return this.active;
  }
}
