import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { watch } from 'node:fs';
import type { AppBackendEvent, AppBackendHealth } from '@workspace/core/backend-protocol/rpc';
import { logMain, warnMain } from './log';
import { BackendRpcSession } from './backend-rpc-session';

export type AppBackendProcessCommand = {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type AppBackendProcessClientOptions = {
  command: AppBackendProcessCommand;
  requestHandlers?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
  spawnProcess?: typeof spawn;
  watchFile?: string | null;
  watchFileSystem?: WatchBackendFile;
};

export type WatchBackendFile = (filePath: string, listener: () => void) => { close(): void };

// Allow the SDK's 12s EOF shutdown plus bounded signal escalation to finish.
const BACKEND_SHUTDOWN_TIMEOUT_MS = 15_000;

export class AppBackendProcessClient {
  private readonly command: AppBackendProcessCommand;
  private readonly spawnProcess: typeof spawn;
  private readonly watchFile: string | null;
  private readonly watchFileSystem: WatchBackendFile;
  private readonly rpc: BackendRpcSession;
  private process: ChildProcessWithoutNullStreams | null = null;
  private watcher: { close(): void } | null = null;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(options: AppBackendProcessClientOptions) {
    this.command = options.command;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.watchFile = options.watchFile ?? null;
    this.watchFileSystem = options.watchFileSystem ?? ((filePath, listener) => watch(filePath, listener));
    this.rpc = new BackendRpcSession({
      requestHandlers: options.requestHandlers,
    });
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const child = this.spawnProcess(this.command.command, this.command.args, {
      cwd: this.command.cwd,
      ...(this.command.env ? { env: { ...process.env, ...this.command.env } } : {}),
      stdio: 'pipe',
    });

    logMain('daemon', 'starting backend process', { command: this.command.command });

    this.process = child;
    child.stdout.on('data', (chunk) => this.rpc.receive(chunk));
    child.stderr.on('data', (chunk) => {
      warnMain('daemon', '', { detail: chunk.toString().trim() });
    });
    child.once('exit', (code, signal) => this.handleDisconnect(child, new Error(`daemon exited before responding (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)));
    child.once('error', (error) => this.handleDisconnect(child, error));

    this.startWatcher();
    this.rpc.connected((message) => child.stdin.write(message));
    logMain('daemon', 'backend process started', { pid: child.pid ?? null });
  }

  async health(): Promise<AppBackendHealth> {
    return this.request<AppBackendHealth>(backendMethods.backendHealthGet);
  }

  async request<Result>(method: string, params?: unknown): Promise<Result> {
    if (!this.process) {
      throw new Error('daemon is not running.');
    }
    return this.rpc.request(method, params);
  }

  onEvent(listener: (event: AppBackendEvent) => void): () => void {
    return this.rpc.onEvent(listener);
  }

  onConnectionState(listener: (state: 'connected' | 'disconnected', error?: Error) => void): () => void {
    return this.rpc.onConnectionState(listener);
  }

  async close(): Promise<void> {
    this.stopWatcher();
    const child = this.process;
    this.process = null;
    this.rpc.close(new Error('daemon client closed.'));

    if (!child || child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, BACKEND_SHUTDOWN_TIMEOUT_MS).unref();
    });
  }

  private startWatcher(): void {
    if (!this.watchFile || this.watcher) {
      return;
    }

    try {
      this.watcher = this.watchFileSystem(this.watchFile, () => {
        this.scheduleRestart();
      });
    } catch (error) {
      warnMain('daemon', 'failed to watch backend bundle', {
        detail: error instanceof Error ? error.message : String(error),
        path: this.watchFile,
      });
    }
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.restart();
    }, 100);
  }

  private async restart(): Promise<void> {
    const child = this.process;
    if (!child || child.killed) {
      return;
    }

    warnMain('daemon', 'restarting backend process after bundle change');
    this.rpc.close(new Error('daemon restarted.'));
    this.process = null;

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, BACKEND_SHUTDOWN_TIMEOUT_MS).unref();
    });

    await this.start();
  }

  private handleDisconnect(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process !== child) return;
    this.process = null;
    this.rpc.disconnected(error);
    warnMain('daemon', 'backend process disconnected', { detail: error.message });
  }
}
