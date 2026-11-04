import { createAppRpcError, createAppRpcNotification, createAppRpcRequest, appRpcErrorCodes, isAppRpcNotification, isAppRpcRequest, isAppRpcResponse, parseAppRpcMessage, type AppRpcId, type AppRpcMessage, type AppRpcResponse } from '@workspace/core/backend-protocol/rpc';
import { appErrorDescriptor } from '@workspace/core/app-error';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { backendRequestTimeoutMs } from '@workspace/core/backend-protocol/request-timeout';
import type { Readable, Writable } from 'node:stream';

export type StdioRpcServerOptions = {
  input: Readable;
  maxBufferedOutputBytes?: number;
  output: Writable;
  onOutputBackpressure?(details: { frameBytes: number; writableLength: number }): void;
  onOutputDrain?(details: { writableLength: number }): void;
  onOutputOverflow?(details: OutputFrameDetails & { bufferedBytes: number; frameBytes: number }): void;
  onMessage(message: AppRpcMessage): AppRpcResponse | undefined | Promise<AppRpcResponse | undefined>;
};

type OutputFrameDetails = {
  eventType?: string;
  id?: AppRpcId | null;
  kind: 'notification' | 'request' | 'response';
  method?: string;
};

export function startStdioRpcServer(options: StdioRpcServerOptions): () => void {
  const peer = new StdioRpcPeer(options);
  peer.start();
  return () => peer.stop();
}

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout | undefined;
};

type QueuedFrame = {
  frame: string;
  bytes: number;
  message: AppRpcMessage;
  loadTiming?: { at: number; metadata: Record<string, unknown> };
};

const DEFAULT_MAX_BUFFERED_OUTPUT_BYTES = 128 * 1024 * 1024;

export class StdioRpcPeer {
  private buffer = '';
  private nextRequestId = 1;
  private readonly pending = new Map<AppRpcId, PendingRequest>();
  private outputBackpressured = false;
  private readonly outputIdleWaiters = new Set<(running: boolean) => void>();
  private readonly outputQueue: QueuedFrame[] = [];
  private outputQueueBytes = 0;
  private started = false;

  constructor(private readonly options: StdioRpcServerOptions & { requestTimeoutMs?: number | null }) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.options.input.on('data', this.onData);
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    for (const resolve of this.outputIdleWaiters) resolve(false);
    this.outputIdleWaiters.clear();
    this.options.input.off('data', this.onData);
    this.options.output.off('drain', this.onOutputDrain);
    this.outputQueue.length = 0;
    this.outputQueueBytes = 0;
    this.outputBackpressured = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('stdio RPC peer stopped.'));
    }
    this.pending.clear();
  }

  request<Result>(method: string, params?: unknown): Promise<Result> {
    const id = `backend-${this.nextRequestId++}`;
    const message = createAppRpcRequest(id, method, params);
    const result = new Promise<Result>((resolve, reject) => {
      const requestTimeoutMs = this.options.requestTimeoutMs === undefined ? defaultRequestTimeoutMs(method, params) : this.options.requestTimeoutMs;
      const timeout = requestTimeoutMs === null ? undefined : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`stdio request timed out: ${method}`));
      // Native helper requests have a 30s inner deadline; the outer callback
      // must leave room for that response (including a helper timeout error).
      // A simulator attach may cold-boot a device before its bridge answers (iOS up to 90s, Android up to 180s).
      }, requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout,
      });
    });

    this.write(message);
    return result;
  }

  notify(method: string, params?: unknown): void {
    this.write(createAppRpcNotification(method, params));
  }

  private readonly onData = (chunk: Buffer | string) => {
    this.buffer += chunk.toString();

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        continue;
      }

      this.handleLine(line);
    }
  };

  private handleLine(line: string): void {
    void this.handleLineAsync(line);
  }

  private async handleLineAsync(line: string): Promise<void> {
    try {
      const parsed = JSON.parse(line) as unknown;
      const message = parseAppRpcMessage(parsed);
      if (isAppRpcResponse(message)) {
        this.handleResponse(message);
        return;
      }
      const loadReceivedAt = performance.now();
      const isLoad = isAppRpcRequest(message) && message.method === backendMethods.agentConversationLoad;
      const markLoad = (stage: string) => {
        if (isLoad && process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') console.warn('[conversation-load] ' + JSON.stringify({ layer: 'daemon-transport', stage,
          id: message.id, agentId: (message.params as { agentId?: string } | undefined)?.agentId, at: performance.timeOrigin + performance.now(),
          elapsedMs: performance.now() - loadReceivedAt, outputBackpressured: this.outputBackpressured, queuedBytes: this.outputQueueBytes }));
      };
      markLoad('request.received');

      // Recovery must not generate replay frames while the transport is still
      // dropping notifications. Legacy requests retain their existing behavior.
      if (isAppRpcRequest(message) && message.method === backendMethods.agentConversationLoad &&
          message.params && typeof message.params === 'object' && 'omitSnapshot' in message.params && message.params.omitSnapshot === true &&
          this.outputBackpressured) {
        const running = await new Promise<boolean>(resolve => this.outputIdleWaiters.add(resolve));
        if (!running) return;
      }
      let response: AppRpcResponse | undefined;
      markLoad('request.dispatch');
      try {
        response = await this.options.onMessage(message);
      } catch (error) {
        response = createAppRpcError(
          'id' in message ? message.id : null,
          appRpcErrorCodes.internalError,
          error instanceof Error ? error.message : String(error),
          appErrorDescriptor(error) ?? undefined,
        );
      }
      if (response) {
        markLoad('request.handled');
        this.write(response, message.method);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON-RPC message.';
      const response = createAppRpcError(null, lineLooksLikeJson(line) ? appRpcErrorCodes.invalidRequest : appRpcErrorCodes.parseError, message);
      this.write(response);
    }
  }

  private handleResponse(response: AppRpcResponse): void {
    if (response.id === null) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
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

  private write(message: AppRpcMessage, responseMethod?: string): void {
    const metadata = conversationLoadFrameMetadata(message, responseMethod);
    const started = performance.now();
    const frame = `${JSON.stringify(message)}\n`;
    const serializedAt = performance.now();
    const bytes = Buffer.byteLength(frame);
    const maxBufferedBytes = this.options.maxBufferedOutputBytes ?? DEFAULT_MAX_BUFFERED_OUTPUT_BYTES;
    if (bytes > maxBufferedBytes) {
      this.reportOutputOverflow(message, bytes, responseMethod);
    }
    if (this.outputBackpressured) {
      const queued = this.enqueueOutput(message, frame, responseMethod, metadata);
      if (metadata && process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') console.warn('[conversation-load] ' + JSON.stringify({ ...metadata, layer: 'daemon-transport', stage: queued ? 'output.queued' : 'output.dropped',
        at: performance.timeOrigin + serializedAt, bytes, serializeMs: serializedAt - started, queuedBytes: this.outputQueueBytes }));
      return;
    }

    const accepted = this.options.output.write(frame);
    if (metadata && process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') console.warn('[conversation-load] ' + JSON.stringify({ ...metadata, layer: 'daemon-transport', stage: 'output.written',
      at: performance.timeOrigin + serializedAt, bytes, serializeMs: serializedAt - started, accepted, writableBytes: this.options.output.writableLength }));
    if (accepted) return;
    this.outputBackpressured = true;
    this.options.onOutputBackpressure?.({
      frameBytes: bytes,
      writableLength: this.options.output.writableLength,
    });
    this.options.output.once('drain', this.onOutputDrain);
  }

  private readonly onOutputDrain = (): void => {
    this.options.onOutputDrain?.({ writableLength: this.options.output.writableLength });
    this.flushOutputQueue();
  };

  private flushOutputQueue(): void {
    while (this.outputQueue.length > 0) {
      const queued = this.outputQueue.shift()!;
      this.outputQueueBytes -= queued.bytes;
      const at = performance.now();
      const accepted = this.options.output.write(queued.frame);
      if (queued.loadTiming && process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD === '1') console.warn('[conversation-load] ' + JSON.stringify({ ...queued.loadTiming.metadata, layer: 'daemon-transport', stage: 'output.flushed',
        at: performance.timeOrigin + at, bytes: queued.bytes, queueMs: at - queued.loadTiming.at, accepted }));
      if (!accepted) {
        this.outputBackpressured = true;
        this.options.output.once('drain', this.onOutputDrain);
        return;
      }
    }

    this.outputBackpressured = false;
    for (const resolve of this.outputIdleWaiters) resolve(true);
    this.outputIdleWaiters.clear();
  }

  private enqueueOutput(message: AppRpcMessage, frame: string, responseMethod?: string, metadata?: Record<string, unknown>): boolean {
    const bytes = Buffer.byteLength(frame);
    if (isAppRpcNotification(message) && message.method === 'backend/event/notify') {
      const existingSnapshotIndex = this.outputQueue.findIndex((queued) => (
        isAppRpcNotification(queued.message) &&
        queued.message.method === 'backend/event/notify' &&
        isSnapshotUpdatedNotification(queued.message) &&
        isSnapshotUpdatedNotification(message)
      ));
      if (existingSnapshotIndex >= 0) {
        const previous = this.outputQueue[existingSnapshotIndex]!;
        this.outputQueue[existingSnapshotIndex] = { frame, bytes, message };
        this.outputQueueBytes += bytes - previous.bytes;
        return true;
      }
    }

    const maxBufferedBytes = this.options.maxBufferedOutputBytes ?? DEFAULT_MAX_BUFFERED_OUTPUT_BYTES;
    if (this.outputQueueBytes + bytes > maxBufferedBytes) {
      if (bytes <= maxBufferedBytes) {
        this.reportOutputOverflow(message, bytes, responseMethod);
      }
      // Notifications are replayable state/event signals; dropping a new one
      // keeps daemon alive and prevents an unbounded Node writable buffer. RPC
      // responses must remain ordered and are allowed to exceed the soft cap.
      if (isAppRpcNotification(message)) return false;
    }
    this.outputQueue.push({ frame, bytes, message, ...(metadata ? { loadTiming: { at: performance.now(), metadata } } : {}) });
    this.outputQueueBytes += bytes;
    return true;
  }

  private reportOutputOverflow(message: AppRpcMessage, frameBytes: number, responseMethod?: string): void {
    this.options.onOutputOverflow?.({
      bufferedBytes: this.outputQueueBytes,
      frameBytes,
      ...outputFrameDetails(message, responseMethod),
    });
  }
}

function conversationLoadFrameMetadata(message: AppRpcMessage, responseMethod?: string): Record<string, unknown> | undefined {
  if (process.env.CODEX_APP_SDK_TRACE_CONVERSATION_LOAD !== '1') return undefined;
  if (isAppRpcResponse(message) && responseMethod === backendMethods.agentConversationLoad) return { id: message.id, kind: 'history-response' };
  if (!isAppRpcNotification(message) || message.method !== backendMethods.backendEventNotify) return undefined;
  const event = message.params as { type?: unknown; agentId?: string; threadId?: string; seq?: number; payload?: { revision?: number } } | undefined;
  if (event?.type !== 'codex.conversationSnapshotChanged') return undefined;
  return { agentId: event.agentId, threadId: event.threadId, seq: event.seq, revision: event.payload?.revision, kind: 'conversation-frame' };
}

function outputFrameDetails(message: AppRpcMessage, responseMethod?: string): OutputFrameDetails {
  if (isAppRpcNotification(message)) {
    const params = message.params;
    return {
      kind: 'notification',
      method: message.method,
      ...(typeof params === 'object' && params !== null && 'type' in params && typeof params.type === 'string'
        ? { eventType: params.type }
        : {}),
    };
  }
  if (isAppRpcRequest(message)) {
    return { kind: 'request', id: message.id, method: message.method };
  }
  if (isAppRpcResponse(message)) {
    return {
      kind: 'response',
      id: message.id,
      ...(responseMethod ? { method: responseMethod } : {}),
    };
  }
  return { kind: 'response' };
}

function isSnapshotUpdatedNotification(message: AppRpcMessage): boolean {
  if (!isAppRpcNotification(message) || message.method !== 'backend/event/notify') {
    return false;
  }
  const params = message.params;
  return typeof params === 'object' && params !== null && 'type' in params && params.type === 'snapshot.updated';
}

function lineLooksLikeJson(line: string): boolean {
  return line.startsWith('{') || line.startsWith('[');
}

function defaultRequestTimeoutMs(method: string, params?: unknown): number | null {
  if (method === backendMethods.clientDebugBackendRestart) return backendRequestTimeoutMs(method);
  if (method === backendMethods.agentGitMessageGenerate || method === backendMethods.driverTextGenerate) return backendRequestTimeoutMs(method, params);
  if (method === backendMethods.clientCollaborationCall) return backendRequestTimeoutMs(method);
  // Let Electron's 30-second browser-open deadline report the navigation failure.
  if (method === 'client/browser/open') return 35_000;
  if (method.startsWith('client/computerUse/')) return 35_000;
  if (method === 'client/mobileSimulator/execute') return 240_000;
  return 5_000;
}
