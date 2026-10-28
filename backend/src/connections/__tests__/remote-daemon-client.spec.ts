import { product } from '@workspace/core/product';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { RemoteConnection } from '@workspace/core/contracts';
import * as mainLog from '../../log';
import { RemoteDaemonClientManager } from '../remote-daemon-client';
import { sshStdioTransport } from '../ssh-connections';

describe('RemoteDaemonClientManager', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows remote catalogs to finish after the old fifteen-second deadline', async () => {
    vi.useFakeTimers();
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });
    const result = manager.request(readyConnection(), backendMethods.agentPluginsList, { agentId: 'remote' });
    const resolved = vi.fn();
    const rejected = vi.fn();
    void result.then(resolved, rejected);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(rejected).not.toHaveBeenCalled();
    const request = JSON.parse(child.stdinLines()[0]!) as { id: number };
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: [] })}\n`);
    await expect(result).resolves.toStrictEqual([]);
    await manager.close();
  });

  it('normalizes persisted SSH stdio transports to the daemon-first command', async () => {
    const child = createChildProcess();
    const spawnProcess = vi.fn(() => child.process);
    const manager = new RemoteDaemonClientManager({ spawnProcess: spawnProcess as never });

    const result = manager.request(readyConnection(), 'source/worktrees/list', {
      repoPath: '/home/nicolas/src/agent-workspace',
    });
    await vi.waitFor(() => expect(child.stdinOutput()).not.toBe(''));
    const request = JSON.parse(child.stdinOutput()) as { id: number; method: string; params: unknown };
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: [{ name: 'main', path: '/home/nicolas/src/agent-workspace' }],
    })}\n`);

    await expect(result).resolves.toStrictEqual([{ name: 'main', path: '/home/nicolas/src/agent-workspace' }]);
    expect(spawnProcess).toHaveBeenCalledWith('ssh', sshStdioTransport('devbox')!.args, {
      stdio: 'pipe',
    });
    expect(request).toMatchObject({
      jsonrpc: '2.0',
      method: 'source/worktrees/list',
      params: { repoPath: '/home/nicolas/src/agent-workspace' },
    });
    await manager.close();
  });

  it('does not warn when daemon-first SSH falls back after a missing remote socket', async () => {
    const child = createChildProcess();
    const warn = vi.spyOn(mainLog, 'warnMain');
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const request = JSON.parse(child.stdinLines()[0]!) as { id: number };
    child.process.stderr.write(`daemon daemon socket unavailable: connect ENOENT /home/mnmt/${product.homeDirectory}/daemon.sock
`);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { ok: true },
    })}\n`);

    await expect(result).resolves.toStrictEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
    await manager.close();
  });

  it('still warns for actionable remote stderr', async () => {
    const child = createChildProcess();
    const warn = vi.spyOn(mainLog, 'warnMain');
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const request = JSON.parse(child.stdinLines()[0]!) as { id: number };
    child.process.stderr.write('remote helper failed to load configuration\n');
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { ok: true },
    })}\n`);

    await expect(result).resolves.toStrictEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith('remote-daemon', '', {
      connectionId: 'connection-devbox',
      detail: 'remote helper failed to load configuration',
    });
    await manager.close();
  });

  it('forwards remote backend event notifications to the event sink', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });
    const onEvent = vi.fn();

    const result = manager.request(readyConnection(), 'driver/prompt/send', {
      agent: { id: 'agent-remote', backend: 'codex' },
      prompt: 'go',
    }, onEvent);
    await vi.waitFor(() => expect(child.stdinOutput()).not.toBe(''));
    const request = JSON.parse(child.stdinOutput()) as { id: number };
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'backend/event/notify',
      params: {
        seq: 1,
        type: 'agent.statusChanged',
        agentId: 'agent-remote',
        payload: { type: 'working' },
        occurredAt: '2026-06-14T10:00:00.000Z',
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { backendSession: { kind: 'codex', threadId: 'thread-remote' } },
    })}\n`);

    await expect(result).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'thread-remote' } });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-remote',
      type: 'agent.statusChanged',
      payload: { type: 'working' },
    }));
    await manager.close();
  });

  it('drops malformed remote events without disturbing pending requests or later events', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });
    const onEvent = vi.fn();
    const warn = vi.spyOn(mainLog, 'warnMain');
    const secret = 'secret-event-value';

    const result = manager.request(readyConnection(), 'driver/prompt/send', {
      agent: { id: 'agent-remote', backend: 'codex' },
      prompt: 'go',
    }, onEvent);
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const request = JSON.parse(child.stdinLines()[0]!) as { id: number };

    for (const params of [
      {
        seq: 1,
        type: 'agent.statusChanged',
        agentId: 'agent-remote',
        payload: { type: secret },
        occurredAt: '2026-06-14T10:00:00.000Z',
      },
      {
        seq: secret,
        backend: 'codex' as const, type: 'backend.statusChanged',
        payload: { backend: 'codex' as const, status: 'running' },
        occurredAt: '2026-06-14T10:00:01.000Z',
      },
      {
        seq: 2,
        type: secret,
        payload: {},
        occurredAt: '2026-06-14T10:00:02.000Z',
      },
    ]) {
      child.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        method: backendMethods.backendEventNotify,
        params,
      })}\n`);
    }
    const validEvent = {
      seq: 3,
      backend: 'codex' as const, type: 'backend.statusChanged',
      payload: { backend: 'codex' as const, status: 'running' },
      occurredAt: '2026-06-14T10:00:03.000Z',
    };
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: backendMethods.backendEventNotify,
      params: validEvent,
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { backendSession: { kind: 'codex', threadId: 'thread-remote' } },
    })}\n`);

    await expect(result).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'thread-remote' } });
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(validEvent);
    expect(child.process.kill).not.toHaveBeenCalled();
    const malformedWarnings = warn.mock.calls.filter(
      ([, message]) => message === 'ignored malformed remote backend event notification',
    );
    expect(malformedWarnings).toHaveLength(3);
    expect(malformedWarnings).toEqual(expect.arrayContaining([
      expect.arrayContaining(['remote-daemon', 'ignored malformed remote backend event notification', {
        connectionId: 'connection-devbox',
        detail: expect.stringContaining('$.payload.type'),
      }]),
      expect.arrayContaining(['remote-daemon', 'ignored malformed remote backend event notification', {
        connectionId: 'connection-devbox',
        detail: expect.stringContaining('$.seq'),
      }]),
      expect.arrayContaining(['remote-daemon', 'ignored malformed remote backend event notification', {
        connectionId: 'connection-devbox',
        detail: expect.stringContaining('$.type'),
      }]),
    ]));
    expect(JSON.stringify(malformedWarnings)).not.toContain(secret);
    await manager.close();
  });

  it('keeps the remote backend event sink across later requests without a sink', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });
    const onEvent = vi.fn();

    const streamingRequest = manager.request(readyConnection(), 'driver/prompt/send', {
      agent: { id: 'agent-remote', backend: 'codex' },
      prompt: 'go',
    }, onEvent);
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const firstRequest = JSON.parse(child.stdinLines()[0]!) as { id: number };
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: firstRequest.id,
      result: { backendSession: { kind: 'codex', threadId: 'thread-remote' } },
    })}\n`);
    await expect(streamingRequest).resolves.toStrictEqual({ backendSession: { kind: 'codex', threadId: 'thread-remote' } });

    const metadataRequest = manager.request(readyConnection(), 'agent/models/list', {
      backend: 'codex',
    });
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(2));
    const secondRequest = JSON.parse(child.stdinLines()[1]!) as { id: number };
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'backend/event/notify',
      params: {
        seq: 2,
        type: 'agent.statusChanged',
        agentId: 'agent-remote',
        payload: { type: 'working' },
        occurredAt: '2026-06-14T10:00:01.000Z',
      },
    })}\n`);
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: secondRequest.id,
      result: [{ id: 'gpt-5', name: 'GPT-5' }],
    })}\n`);

    await expect(metadataRequest).resolves.toStrictEqual([{ id: 'gpt-5', name: 'GPT-5' }]);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      seq: 2,
      agentId: 'agent-remote',
      type: 'agent.statusChanged',
    }));
    await manager.close();
  });

  it('rejects pending requests and reconnects after malformed remote stdout', async () => {
    const firstChild = createChildProcess();
    const secondChild = createChildProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstChild.process)
      .mockReturnValueOnce(secondChild.process);
    const manager = new RemoteDaemonClientManager({ spawnProcess: spawnProcess as never });

    const firstResult = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(firstChild.stdinLines()).toHaveLength(1));
    firstChild.stdout.write('not json-rpc\n');

    await expect(firstResult).rejects.toThrow('Invalid remote backend response');
    expect(firstChild.process.kill).toHaveBeenCalledOnce();

    const secondResult = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(secondChild.stdinLines()).toHaveLength(1));
    const secondRequest = JSON.parse(secondChild.stdinLines()[0]!) as { id: number };
    secondChild.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: secondRequest.id,
      result: { ok: true },
    })}\n`);

    await expect(secondResult).resolves.toStrictEqual({ ok: true });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it('answers remote backend client requests through injected request handlers', async () => {
    const child = createChildProcess();
    const openExternal = vi.fn().mockResolvedValue(true);
    const manager = new RemoteDaemonClientManager({
      requestHandlers: {
        [backendMethods.clientExternalOpen]: openExternal,
      },
      spawnProcess: vi.fn(() => child.process) as never,
    });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const healthRequest = JSON.parse(child.stdinLines()[0]!) as { id: number };

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'client-1',
      method: backendMethods.clientExternalOpen,
      params: { url: 'https://github.com/login/device?user_code=ABCD-1234' },
    })}\n`);
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(2));

    expect(openExternal).toHaveBeenCalledWith({ url: 'https://github.com/login/device?user_code=ABCD-1234' });
    expect(JSON.parse(child.stdinLines()[1]!)).toStrictEqual({
      jsonrpc: '2.0',
      id: 'client-1',
      result: true,
    });

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: healthRequest.id,
      result: { ok: true },
    })}\n`);
    await expect(result).resolves.toStrictEqual({ ok: true });
    await manager.close();
  });

  it('returns method-not-found for unknown remote backend client requests', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const healthRequest = JSON.parse(child.stdinLines()[0]!) as { id: number };

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'client-unknown',
      method: 'client/nope',
      params: {},
    })}\n`);
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(2));

    expect(JSON.parse(child.stdinLines()[1]!)).toStrictEqual({
      jsonrpc: '2.0',
      id: 'client-unknown',
      error: {
        code: -32601,
        message: 'Unknown client method: client/nope',
      },
    });

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: healthRequest.id,
      result: { ok: true },
    })}\n`);
    await expect(result).resolves.toStrictEqual({ ok: true });
    await manager.close();
  });

  it('returns internal errors for failed remote backend client requests and keeps later requests alive', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({
      requestHandlers: {
        [backendMethods.clientExternalOpen]: vi.fn().mockRejectedValue(new Error('browser unavailable')),
      },
      spawnProcess: vi.fn(() => child.process) as never,
    });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(1));
    const healthRequest = JSON.parse(child.stdinLines()[0]!) as { id: number };

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'client-failed',
      method: backendMethods.clientExternalOpen,
      params: { url: 'https://example.com' },
    })}\n`);
    await vi.waitFor(() => expect(child.stdinLines()).toHaveLength(2));

    expect(JSON.parse(child.stdinLines()[1]!)).toStrictEqual({
      jsonrpc: '2.0',
      id: 'client-failed',
      error: {
        code: -32603,
        message: 'browser unavailable',
      },
    });

    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: healthRequest.id,
      result: { ok: true },
    })}\n`);
    await expect(result).resolves.toStrictEqual({ ok: true });
    await manager.close();
  });

  it('rejects requests for connections without a ready transport', async () => {
    const manager = new RemoteDaemonClientManager();

    await expect(manager.request({
      ...readyConnection(),
      status: 'saved',
      transport: undefined,
    }, 'backend/health/get')).rejects.toThrow('Remote connection is not ready');
  });

  it('evicts exited clients so the next request reconnects', async () => {
    const firstChild = createChildProcess();
    const secondChild = createChildProcess();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstChild.process)
      .mockReturnValueOnce(secondChild.process);
    const manager = new RemoteDaemonClientManager({ spawnProcess: spawnProcess as never });

    const firstResult = manager.request(readyConnection(), 'backend/health/get');
    const parallelResult = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(firstChild.stdinLines()).toHaveLength(2));
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const parallelRequest = JSON.parse(firstChild.stdinLines()[1]!) as { id: number };
    firstChild.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: parallelRequest.id, result: { ok: true } })}\n`);
    const firstRequest = JSON.parse(firstChild.stdinLines()[0]!) as { id: number };
    firstChild.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: firstRequest.id,
      result: { ok: true },
    })}\n`);
    await expect(firstResult).resolves.toStrictEqual({ ok: true });
    await expect(parallelResult).resolves.toStrictEqual({ ok: true });

    firstChild.process.emit('exit', 0, null);

    const secondResult = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(secondChild.stdinLines()).toHaveLength(1));
    const secondRequest = JSON.parse(secondChild.stdinLines()[0]!) as { id: number };
    secondChild.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: secondRequest.id,
      result: { ok: true },
    })}\n`);

    await expect(secondResult).resolves.toStrictEqual({ ok: true });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    await manager.close();
  });

  it('closes a cached client for a single connection', async () => {
    const child = createChildProcess();
    const manager = new RemoteDaemonClientManager({ spawnProcess: vi.fn(() => child.process) as never });

    const result = manager.request(readyConnection(), 'backend/health/get');
    await vi.waitFor(() => expect(child.stdinOutput()).not.toBe(''));

    await manager.closeConnection('connection-devbox');

    await expect(result).rejects.toThrow('remote daemon client closed');
    expect(child.process.kill).toHaveBeenCalledOnce();
  });
});

function readyConnection(): RemoteConnection {
  return {
    id: 'connection-devbox',
    kind: 'ssh',
    name: 'devbox',
    host: 'devbox',
    status: 'ready',
    transport: {
      type: 'ssh-stdio',
      command: 'ssh',
      args: ['devbox', `node ~/${product.homeDirectory}/daemon.mjs --stdio`],
    },
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z',
  };
}

function createChildProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinChunks: Buffer[] = [];
  stdin.on('data', (chunk: Buffer) => stdinChunks.push(chunk));

  process.stdin = stdin;
  process.stdout = stdout;
  process.stderr = stderr;
  process.killed = false;
  process.kill = vi.fn(() => {
    process.killed = true;
    process.emit('exit', 0, null);
    return true;
  });

  return {
    process,
    stdout,
    stdinOutput: () => Buffer.concat(stdinChunks).toString('utf8').trim(),
    stdinLines: () => Buffer.concat(stdinChunks).toString('utf8').trim().split('\n').filter(Boolean),
  };
}
