import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { backendRequestTimeoutMs } from '@workspace/core/backend-protocol/request-timeout';
import { createCodexBrowserWebSocketPort, type CodexWebSocketPort } from '@codex-app-sdk/web/client';
import type { AppApi, MainToRendererEvent } from '@workspace/core/contracts';
import {
  AppWebEventDecodeError,
  appWebProtocolVersion,
  encodeAppWebMessage,
  parseAppWebServerMessage,
} from './protocol';

export type CreateAppBrowserClientOptions = {
  createSocket(): WebSocket;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export function createAppBrowserClient(options: CreateAppBrowserClientOptions): AppApi {
  const transport = new AppBrowserTransport(options);
  // Renderer catalog caches compare API functions by identity, so each operation
  // must resolve to one stable function for the life of the client.
  const operations = new Map<string, (...args: unknown[]) => unknown>();
  const onEvent = (listener: (event: MainToRendererEvent) => void) => transport.onEvent(listener);
  const noopSubscription = () => () => undefined;
  // Selection is renderer-owned; this hook only refreshes Electron's debug menu.
  const selectMission = async () => undefined;
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'onEvent') return onEvent;
      if (property === 'selectMission') return selectMission;
      if (property === 'onAppCommand' || property === 'onUpdateStatusChanged') return noopSubscription;
      if (typeof property !== 'string') return undefined;
      let operation = operations.get(property);
      if (!operation) {
        operation = (...args: unknown[]) => transport.invoke(property, args);
        operations.set(property, operation);
      }
      return operation;
    },
  }) as AppApi;
}

class AppBrowserTransport {
  private readonly listeners = new Set<(event: MainToRendererEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private socket: CodexWebSocketPort | null = null;
  private connectPromise: Promise<void> | null = null;
  private sequence = 0;

  constructor(private readonly options: CreateAppBrowserClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async invoke(operation: string, args: unknown[]): Promise<unknown> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error(`${product.name} web socket is not connected.`);
    const id = `app-${++this.sequence}`;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${product.name} web request timed out: ${operation}`));
      }, operation === 'installProvider'
        ? this.options.requestTimeoutMs ?? backendRequestTimeoutMs(backendMethods.providerInstall)
        : this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    socket.send(encodeAppWebMessage({
      version: appWebProtocolVersion,
      type: 'request',
      id,
      operation,
      args: trimTrailingUndefined(args),
    }));
    return result;
  }

  onEvent(listener: (event: MainToRendererEvent) => void): () => void {
    this.listeners.add(listener);
    void this.connect();
    return () => this.listeners.delete(listener);
  }

  private connect(): Promise<void> {
    if (this.socket) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const rawSocket = this.options.createSocket();
      const socket = createCodexBrowserWebSocketPort(rawSocket);
      let ready = false;
      socket.onMessage((data) => {
        try {
          const message = parseAppWebServerMessage(JSON.parse(webSocketText(data)));
          if (message.type === 'ready') {
            ready = true;
            this.socket = socket;
            resolve();
            return;
          }
          if (message.type === 'event') {
            for (const listener of this.listeners) listener(message.event);
            return;
          }
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(new Error(message.error));
        } catch (error) {
          if (error instanceof AppWebEventDecodeError) console.warn(error.message);
          else if (!ready) reject(error);
        }
      });
      socket.onClose(() => {
        if (this.socket === socket) this.socket = null;
        this.connectPromise = null;
        const error = new Error(`${product.name} web socket disconnected.`);
        for (const request of this.pending.values()) {
          clearTimeout(request.timeout);
          request.reject(error);
        }
        this.pending.clear();
        if (!ready) reject(error);
      });
      socket.onError?.((error) => {
        if (!ready) reject(error instanceof Error ? error : new Error(String(error)));
      });
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }
}

function trimTrailingUndefined(args: unknown[]): unknown[] {
  let length = args.length;
  while (length > 0 && args[length - 1] === undefined) length -= 1;
  return args.slice(0, length);
}

function webSocketText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  throw new TypeError(`${product.name} WebSocket messages must contain text or UTF-8 bytes.`);
}
