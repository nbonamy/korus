import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import * as mainLog from '../log';
import { AppBackendProcessClient } from '../backend-process-client';

describe('AppBackendProcessClient', () => {
  it('delivers a long-running Viz response after an hour', async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['daemon', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    await client.start();
    try {
      const pending = client.request(backendMethods.agentGitMessageGenerate, {
        agentId: 'a', input: { kind: 'viz', generationId: 'long' },
      }).then(value => ({ value }), error => ({ error }));
      const request = JSON.parse(child.stdin.writes[0]);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { kind: 'viz' } })}\n`);
      expect(await pending).toEqual({ value: { kind: 'viz' } });
    } finally { await client.close(); }
  });

  it('waits for provider history flush before finishing shutdown', async () => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();
    child.kill.mockImplementation(() => true);
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    await client.start();
    const finished = vi.fn();
    const closing = client.close().then(finished);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(finished).not.toHaveBeenCalled();
    child.emit('exit', 0, null);
    await closing;
    expect(finished).toHaveBeenCalledOnce();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends backend health over stdio and resolves the response', async () => {
    const child = createFakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess,
    });

    await client.start();
    const healthPromise = client.health();
    const request = JSON.parse(child.stdin.writes[0]);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        ok: true,
        name: 'daemon',
        version: '0.1.0',
        pid: 123,
      },
    })}\n`);

    await expect(healthPromise).resolves.toStrictEqual({
      ok: true,
      name: 'daemon',
      version: '0.1.0',
      pid: 123,
    });
    expect(spawnProcess).toHaveBeenCalledWith('node', ['client/backend/dist/daemon.mjs', '--stdio'], {
      cwd: undefined,
      stdio: 'pipe',
    });
  });

  it.each([
    backendMethods.snapshotGet,
    backendMethods.agentPluginsList,
    backendMethods.agentPromptSend,
    backendMethods.agentTurnDelete,
    backendMethods.agentTurnEdit,
    backendMethods.agentTurnRetry,
  ])('accepts a successful delayed response for %s', async (method) => {
    vi.useFakeTimers();
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });

    await client.start();
    const response = client.request<{ ok: true }>(method, { agentId: 'agent-dina', turnId: 'turn-1' });
    const request = JSON.parse(child.stdin.writes[0]);
    await vi.advanceTimersByTimeAsync(6_000);
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } })}\n`);

    await expect(response).resolves.toStrictEqual({ ok: true });
  });

  it('rejects requests without an explicit timeout policy before sending them', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });

    await client.start();
    await expect(client.request('missing/method')).rejects.toThrow('No backend request timeout configured for missing/method.');
    expect(child.stdin.writes).toHaveLength(0);
  });

  it('passes configured backend environment to the spawned process', async () => {
    const child = createFakeChildProcess();
    const spawnProcess = vi.fn().mockReturnValue(child);
    const client = new AppBackendProcessClient({
      command: {
        command: 'node',
        args: ['client/backend/dist/daemon.mjs', '--stdio'],
        env: {
          APP_ASSETS_PATH: '/app/resources',
        },
      },
      spawnProcess,
    });

    await client.start();

    expect(spawnProcess).toHaveBeenCalledWith('node', ['client/backend/dist/daemon.mjs', '--stdio'], {
      cwd: undefined,
      env: expect.objectContaining({
        APP_ASSETS_PATH: '/app/resources',
      }),
      stdio: 'pipe',
    });
  });

  it('emits backend event notifications from stdio', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    const listener = vi.fn();

    await client.start();
    client.onEvent(listener);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: backendMethods.backendEventNotify,
      params: {
        seq: 1,
        backend: 'codex',
        agentId: 'agent-dina',
        type: 'agent.statusChanged',
        payload: { type: 'working' },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
    })}\n`);

    expect(listener).toHaveBeenCalledWith({
      seq: 1,
      backend: 'codex',
      agentId: 'agent-dina',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
      occurredAt: '2026-06-13T00:00:00.000Z',
    });
  });

  it('ignores malformed backend events without interrupting later notifications', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    const listener = vi.fn();
    const warn = vi.spyOn(mainLog, 'warnMain');
    const secret = 'secret-event-value';

    await client.start();
    client.onEvent(listener);
    for (const params of [
      {
        seq: 1,
        type: 'agent.statusChanged',
        agentId: 'agent-dina',
        payload: { type: secret },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
      {
        seq: secret,
        backend: 'codex' as const, type: 'backend.statusChanged',
        payload: { backend: 'codex' as const, status: 'running' },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
      {
        seq: 2,
        type: secret,
        payload: {},
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
    ]) {
      child.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        method: backendMethods.backendEventNotify,
        params,
      })}\n`);
    }
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: backendMethods.backendEventNotify,
      params: {
        seq: 3,
        backend: 'codex' as const, type: 'backend.statusChanged',
        payload: { backend: 'codex' as const, status: 'running' },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
    })}\n`);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ seq: 3 }));
    const malformedWarnings = warn.mock.calls.filter(
      ([, message]) => message === 'ignored malformed backend event notification',
    );
    expect(malformedWarnings).toHaveLength(3);
    expect(malformedWarnings).toEqual(expect.arrayContaining([
      expect.arrayContaining(['daemon', 'ignored malformed backend event notification', {
        detail: expect.stringContaining('$.payload.type'),
      }]),
      expect.arrayContaining(['daemon', 'ignored malformed backend event notification', {
        detail: expect.stringContaining('$.seq'),
      }]),
      expect.arrayContaining(['daemon', 'ignored malformed backend event notification', {
        detail: expect.stringContaining('$.type'),
      }]),
    ]));
    expect(JSON.stringify(malformedWarnings)).not.toContain(secret);
  });

  it('ignores legacy backend event notification names', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    const listener = vi.fn();

    await client.start();
    client.onEvent(listener);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'backend/event',
      params: {
        seq: 1,
        type: 'snapshot.updated',
        payload: { ok: true },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
    })}\n`);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps resolving requests when notifications arrive before responses', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    const listener = vi.fn();

    await client.start();
    client.onEvent(listener);
    const healthPromise = client.health();
    const request = JSON.parse(child.stdin.writes[0]);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: backendMethods.backendEventNotify,
      params: {
        seq: 1,
        type: 'backend.statusChanged',
        backend: 'codex',
        payload: { backend: 'codex', status: 'running' },
        occurredAt: '2026-06-13T00:00:00.000Z',
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        ok: true,
        name: 'daemon',
        version: '0.1.0',
        pid: 123,
      },
    })}\n`);

    await expect(healthPromise).resolves.toMatchObject({ ok: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('preserves malformed JSON and JSON-RPC framing behavior', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });
    const warn = vi.spyOn(mainLog, 'warnMain');

    await client.start();
    child.stdout.write('not json\n');
    child.stdout.write(`${JSON.stringify({ jsonrpc: '1.0', method: 'invalid' })}\n`);
    const healthPromise = client.health();
    const request = JSON.parse(child.stdin.writes[0]);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { ok: true, name: 'daemon', version: '0.1.0', pid: 123 },
    })}\n`);

    await expect(healthPromise).resolves.toMatchObject({ ok: true });
    const parseWarnings = warn.mock.calls.filter(
      ([, message]) => message === 'failed to parse backend response',
    );
    expect(parseWarnings).toHaveLength(2);
    expect(parseWarnings).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        'daemon',
        'failed to parse backend response',
        expect.objectContaining({ bytes: expect.any(Number) }),
      ]),
    ]));
  });

  it('handles backend-initiated client requests over stdio', async () => {
    const child = createFakeChildProcess();
    const openExternal = vi.fn().mockResolvedValue(true);
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      requestHandlers: {
        'client/external/open': openExternal,
      },
      spawnProcess: vi.fn().mockReturnValue(child),
    });

    await client.start();
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'client-1',
      method: 'client/external/open',
      params: { url: 'https://example.com' },
    })}\n`);
    await flushMicrotasks();

    expect(openExternal).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(JSON.parse(child.stdin.writes[0])).toStrictEqual({
      jsonrpc: '2.0',
      id: 'client-1',
      result: true,
    });
  });

  it('returns JSON-RPC errors for unknown backend-initiated client requests', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });

    await client.start();
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'client-1',
      method: 'client/nope',
      params: {},
    })}\n`);
    await flushMicrotasks();

    expect(JSON.parse(child.stdin.writes[0])).toMatchObject({
      jsonrpc: '2.0',
      id: 'client-1',
      error: {
        code: -32601,
        message: 'Unknown client method: client/nope',
      },
    });
  });

  it('rejects pending requests when the process exits', async () => {
    const child = createFakeChildProcess();
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess: vi.fn().mockReturnValue(child),
    });

    await client.start();
    const requestPromise = client.health();
    child.emit('exit', 1, null);

    await expect(requestPromise).rejects.toThrow('daemon exited before responding');
  });

  it('reports unexpected exits and starts a fresh process on reconnect', async () => {
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess,
    });
    const connectionListener = vi.fn();
    client.onConnectionState(connectionListener);

    await client.start();
    firstChild.emit('exit', 7, null);
    await client.start();

    expect(connectionListener).toHaveBeenNthCalledWith(1, 'connected', undefined);
    expect(connectionListener).toHaveBeenNthCalledWith(2, 'disconnected', expect.any(Error));
    expect(connectionListener).toHaveBeenNthCalledWith(3, 'connected', undefined);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('restarts the backend when an explicit bundle watcher is configured', async () => {
    vi.useFakeTimers();
    const firstChild = createFakeChildProcess();
    const secondChild = createFakeChildProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const watcher = { close: vi.fn() };
    const watchListenerRef: { current: (() => void) | null } = { current: null };
    const watchFileSystem = vi.fn((_file: string, listener: () => void) => {
      watchListenerRef.current = listener;
      return watcher;
    });
    const client = new AppBackendProcessClient({
      command: { command: 'node', args: ['client/backend/dist/daemon.mjs', '--stdio'] },
      spawnProcess,
      watchFile: '/repo/backend/dist/daemon.mjs',
      watchFileSystem,
    });

    await client.start();
    expect(watchFileSystem).toHaveBeenCalledWith('/repo/backend/dist/daemon.mjs', expect.any(Function));
    watchListenerRef.current?.();
    await vi.advanceTimersByTimeAsync(100);

    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    await client.close();
    expect(watcher.close).toHaveBeenCalledOnce();
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

function createFakeChildProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new WritableCapture();
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  const child = {
    stdout,
    stderr,
    stdin,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
      child.emit('exit', 0, null);
      return true;
    }),
    once: (event: string, listener: (...args: unknown[]) => void) => {
      const onceListener = (...args: unknown[]) => {
        child.off(event, onceListener);
        listener(...args);
      };
      child.on(event, onceListener);
      return child;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return child;
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
      return child;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
      return true;
    },
  };

  return child;
}

class WritableCapture extends PassThrough {
  readonly writes: string[] = [];

  override write(chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    this.writes.push(chunk.toString());

    const maybeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    maybeCallback?.();
    return true;
  }
}
