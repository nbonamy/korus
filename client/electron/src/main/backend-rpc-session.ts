import { backendMethods } from '@workspace/core/backend-protocol/methods';
import {
  decodeAppBackendEvent,
  type AppBackendEvent,
} from '@workspace/core/backend-protocol/events';
import {
  createAppRpcError,
  createAppRpcResult,
  appRpcErrorCodes,
  isAppRpcNotification,
  isAppRpcRequest,
  isAppRpcResponse,
  parseAppRpcMessage,
  type AppRpcId,
  type AppRpcRequest,
  type AppRpcResponse,
} from '@workspace/core/backend-protocol/rpc';
import { warnMain } from './log';
import { backendRequestTimeoutMs } from './backend-request-timeout';

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

export type BackendRpcSessionOptions = {
  requestHandlers?: Record<string, (params: unknown) => unknown | Promise<unknown>>;
};

/** Owns JSON-RPC framing and request lifecycle independently of the active transport. */
export class BackendRpcSession {
  private readonly requestHandlers: Record<string, (params: unknown) => unknown | Promise<unknown>>;
  private readonly pending = new Map<AppRpcId, PendingRequest>();
  private readonly eventListeners = new Set<(event: AppBackendEvent) => void>();
  private readonly connectionStateListeners = new Set<(state: 'connected' | 'disconnected', error?: Error) => void>();
  private buffer = '';
  private nextRequestId = 1;
  private write: ((message: string) => void) | null = null;

  constructor(options: BackendRpcSessionOptions = {}) {
    this.requestHandlers = options.requestHandlers ?? {};
  }

  connected(write: (message: string) => void): void {
    this.write = write;
    this.buffer = '';
    this.emitConnectionState('connected');
  }

  disconnected(error: Error): void {
    if (!this.write) return;
    this.write = null;
    this.buffer = '';
    this.rejectPending(error);
    this.emitConnectionState('disconnected', error);
  }

  close(error: Error): void {
    this.write = null;
    this.buffer = '';
    this.rejectPending(error);
  }

  receive(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
    }
  }

  request<Result>(method: string, params?: unknown): Promise<Result> {
    if (!this.write) throw new Error('daemon is not connected.');

    const requestTimeoutMs = backendRequestTimeoutMs(method);
    const id = this.nextRequestId++;
    const message = params === undefined
      ? { jsonrpc: '2.0' as const, id, method }
      : { jsonrpc: '2.0' as const, id, method, params };
    const result = new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        warnMain('daemon', 'request timed out', { method, id });
        reject(new Error(`daemon request timed out: ${method}`));
      }, requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout,
      });
    });

    this.write(`${JSON.stringify(message)}\n`);
    return result;
  }

  onEvent(listener: (event: AppBackendEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnectionState(listener: (state: 'connected' | 'disconnected', error?: Error) => void): () => void {
    this.connectionStateListeners.add(listener);
    return () => this.connectionStateListeners.delete(listener);
  }

  private handleLine(line: string): void {
    let response: AppRpcResponse;
    try {
      const message = parseAppRpcMessage(JSON.parse(line));
      if (isAppRpcNotification(message)) {
        this.handleNotification(message);
        return;
      }
      if (isAppRpcRequest(message)) {
        void this.handleRequest(message);
        return;
      }
      if (!isAppRpcResponse(message)) {
        warnMain('daemon', 'ignored non-response message from backend', { line });
        return;
      }
      response = message;
    } catch (error) {
      warnMain('daemon', 'failed to parse backend response', {
        detail: error instanceof Error ? error.message : 'Invalid backend response.',
        bytes: line.length,
      });
      response = createAppRpcError(
        null,
        appRpcErrorCodes.parseError,
        error instanceof Error ? error.message : 'Invalid backend response.',
      );
    }

    if (response.id === null) {
      warnMain('daemon', 'backend response without request id', { response });
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      warnMain('daemon', 'backend response for unknown request id', { id: response.id });
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    if ('error' in response) {
      pending.reject(Object.assign(new Error(response.error.message), { data: response.error.data }));
      return;
    }
    pending.resolve(response.result);
  }

  private async handleRequest(message: AppRpcRequest): Promise<void> {
    const handler = this.requestHandlers[message.method];
    if (!handler) {
      this.writeResponse(createAppRpcError(
        message.id,
        appRpcErrorCodes.methodNotFound,
        `Unknown client method: ${message.method}`,
      ));
      return;
    }

    try {
      this.writeResponse(createAppRpcResult(message.id, await handler(message.params)));
    } catch (error) {
      this.writeResponse(createAppRpcError(
        message.id,
        appRpcErrorCodes.internalError,
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  private handleNotification(message: ReturnType<typeof parseAppRpcMessage>): void {
    if (!isAppRpcNotification(message)) return;
    if (message.method !== backendMethods.backendEventNotify) {
      warnMain('daemon', 'ignored unknown backend notification', { method: message.method });
      return;
    }
    let event: AppBackendEvent;
    try {
      event = decodeAppBackendEvent(message.params);
    } catch (error) {
      warnMain('daemon', 'ignored malformed backend event notification', {
        detail: error instanceof Error ? error.message : 'Invalid backend event notification.',
      });
      return;
    }
    for (const listener of this.eventListeners) listener(event);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitConnectionState(state: 'connected' | 'disconnected', error?: Error): void {
    for (const listener of this.connectionStateListeners) listener(state, error);
  }

  private writeResponse(response: AppRpcResponse): void {
    this.write?.(`${JSON.stringify(response)}\n`);
  }
}
