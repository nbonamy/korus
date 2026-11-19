import { mkdtemp } from 'node:fs/promises';
import { product } from '@workspace/core/product';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import backendPackage from '../../package.json';
import { DAEMON_VERSION, connectToDaemon, main } from '../daemon';
import { LocalSocketRpcServer } from '../socket-server';

describe('daemon entrypoint', () => {
  const originalExitCode = process.exitCode;
  const originalTitle = process.title;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let socketServer: LocalSocketRpcServer | null = null;

  afterEach(async () => {
    await socketServer?.stop();
    socketServer = null;
    process.exitCode = originalExitCode;
    process.title = originalTitle;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  it('uses the backend package version', async () => {
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    await main(['--version']);

    expect(DAEMON_VERSION).toBe(backendPackage.version);
    expect(writes.join('')).toBe(`${product.daemonName} ${backendPackage.version}\n`);
    expect(process.title).toBe(product.daemonName);
  });

  it('rejects --state-dir so APP_HOME is the only state-home override', async () => {
    const writes: string[] = [];
    process.exitCode = undefined;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    await main(['--stdio', '--state-dir', '/tmp/agent-workspace']);

    expect(process.exitCode).toBe(1);
    expect(writes.join('')).toContain('Unsupported option: --state-dir');
    expect(writes.join('')).toContain('APP_HOME');
  });

  it('prints usage and exits non-zero when no command is selected', async () => {
    const writes: string[] = [];
    process.exitCode = undefined;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    await main([]);

    expect(process.exitCode).toBe(1);
    expect(writes.join('')).toContain(`Usage: ${product.daemonName} --stdio | serve | connect | companion-relay <config-file> | --version`);
  });

  it('starts a socket daemon on demand and reconnects to it after disconnect', async () => {
    const socketPath = await tempSocketPath();
    let starts = 0;
    let requests = 0;
    const startDaemon = async () => {
      starts++;
      socketServer = new LocalSocketRpcServer({
        socketPath,
        onMessage: (message) => ({
          jsonrpc: '2.0',
          id: 'id' in message ? message.id : null,
          result: 'id' in message && message.id === '__korus-verify-version' ? { version: '1.0.0' } : { requests: ++requests },
        }),
      });
      await socketServer.start();
    };

    for (const expectedRequests of [1, 2]) {
      const input = new PassThrough();
      const output = new PassThrough();
      const response = new Promise<string>(resolve => output.once('data', chunk => resolve(chunk.toString())));
      const connect = connectToDaemon({ input, output, socketPath, startDaemon, expectedVersion: '1.0.0' });
      input.write('{"jsonrpc":"2.0","id":"health","method":"backend/health/get"}\n');
      try {
        expect(await Promise.race([response.then(JSON.parse), connect])).toMatchObject({ id: 'health', result: { requests: expectedRequests } });
      } finally {
        input.end();
        await connect;
      }
    }
    expect(starts).toBe(1);
  });

  it('refuses an outdated running daemon without starting a second writer', async () => {
    const socketPath = await tempSocketPath();
    socketServer = new LocalSocketRpcServer({ socketPath, onMessage: message => ({ jsonrpc: '2.0', id: 'id' in message ? message.id : null, result: { version: '0.35.1' } }) });
    await socketServer.start();
    const input = new PassThrough(), output = new PassThrough(), stderr = new PassThrough();
    const errors: Buffer[] = [];
    stderr.on('data', chunk => errors.push(chunk));
    await expect(connectToDaemon({ input, output, stderr, socketPath, expectedVersion: '0.45.1' })).resolves.toBe(2);
    expect(Buffer.concat(errors).toString()).toContain('Restart');
    expect(output.readableLength).toBe(0);
  });

  it('exits non-zero when daemon connect cannot reach the daemon socket', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stderr = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => outputChunks.push(chunk));

    await expect(connectToDaemon({
      input,
      output,
      stderr,
      socketPath: await tempSocketPath(),
    })).resolves.toBe(1);

    expect(Buffer.concat(outputChunks).toString('utf8')).toBe('');
  });

  it.each(['socket', 'input', 'output'] as const)('exits non-zero when the connected %s stream fails', async (failingStream) => {
    const socket = new PassThrough() as PassThrough & { destroy: () => PassThrough };
    const input = new PassThrough();
    const output = new PassThrough();
    const connected = new Promise<void>(resolve => input.once('resume', resolve));
    const connect = connectToDaemon({
      connectSocket: (() => {
        queueMicrotask(() => socket.emit('connect'));
        return socket as unknown as ReturnType<typeof import('node:net').createConnection>;
      }) as never,
      input,
      output,
      socketPath: '/tmp/fake-daemon.sock',
    });
    await connected;

    (failingStream === 'socket' ? socket : failingStream === 'input' ? input : output).emit('error', new Error('stream failed'));

    await expect(connect).resolves.toBe(3);
  });
});

async function tempSocketPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'daemon-connect-test-'));
  return path.join(dir, 'daemon.sock');
}
