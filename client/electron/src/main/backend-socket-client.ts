import { backendMethods } from '@workspace/core/backend-protocol/methods';
import net, { type Socket } from 'node:net';
import type { AppBackendEvent, AppBackendHealth } from '@workspace/core/backend-protocol/rpc';
import { createRuntimeClientRequestHandlers } from './client-request-handlers';
import { logMain, warnMain } from './log';
import { BackendRpcSession } from './backend-rpc-session';

export type AppBackendSocketClientOptions = {
  connectSocket?: typeof net.createConnection;
  requestHandlers?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
  socketPath: string;
};

export class AppBackendSocketClient {
  private readonly connectSocket: typeof net.createConnection;
  private readonly rpc: BackendRpcSession;
  private socket: Socket | null = null;

  constructor(private readonly options: AppBackendSocketClientOptions) {
    this.connectSocket = options.connectSocket ?? net.createConnection;
    this.rpc = new BackendRpcSession({
      requestHandlers: options.requestHandlers ?? createRuntimeClientRequestHandlers(),
    });
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = this.connectSocket(this.options.socketPath);
    this.socket = socket;
    logMain('daemon', 'connecting to backend socket');
    socket.on('data', (chunk) => this.rpc.receive(chunk));
    socket.once('close', () => this.handleDisconnect(socket, new Error('daemon socket closed.')));
    socket.once('error', (error) => this.handleDisconnect(socket, error));

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.rpc.connected((message) => socket.write(message));
    logMain('daemon', 'backend socket connected');
  }

  async health(): Promise<AppBackendHealth> {
    return this.request<AppBackendHealth>(backendMethods.backendHealthGet);
  }

  async request<Result>(method: string, params?: unknown): Promise<Result> {
    if (!this.socket) {
      throw new Error('daemon socket is not connected.');
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
    const socket = this.socket;
    this.socket = null;
    this.rpc.close(new Error('daemon socket client closed.'));
    if (!socket || socket.destroyed) {
      return;
    }
    await new Promise<void>((resolve) => {
      socket.once('close', resolve);
      socket.end();
      setTimeout(resolve, 1_000).unref();
    });
  }

  private handleDisconnect(socket: Socket, error: Error): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.rpc.disconnected(error);
    warnMain('daemon', 'backend socket disconnected', { detail: error.message });
  }
}
