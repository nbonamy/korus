import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { LocalSocketRpcServer } from '../socket-server';

describe('LocalSocketRpcServer', () => {
  let server: LocalSocketRpcServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('serves JSON-RPC requests over a Unix socket', async () => {
    const socketPath = await tempSocketPath();
    server = new LocalSocketRpcServer({
      socketPath,
      onMessage: (message) => ({
        jsonrpc: '2.0',
        id: 'id' in message ? message.id : null,
        result: { method: 'method' in message ? message.method : 'none' },
      }),
    });
    await server.start();
    const socket = await connect(socketPath);
    const responses: string[] = [];
    socket.on('data', (chunk) => responses.push(chunk.toString()));

    socket.write('{"jsonrpc":"2.0","id":"health","method":"backend/health/get"}\n');
    await waitFor(() => responses.join('').includes('"backend/health/get"'));

    expect(JSON.parse(responses.join(''))).toStrictEqual({
      jsonrpc: '2.0',
      id: 'health',
      result: { method: 'backend/health/get' },
    });
    socket.destroy();
  });

  it('broadcasts backend events to connected clients', async () => {
    const payload = createInitialSnapshot();
    const socketPath = await tempSocketPath();
    server = new LocalSocketRpcServer({
      socketPath,
      onMessage: () => undefined,
    });
    await server.start();
    const socket = await connect(socketPath);
    const responses: string[] = [];
    socket.on('data', (chunk) => responses.push(chunk.toString()));

    server.broadcastEvent({
      seq: 1,
      type: 'snapshot.updated',
      payload,
      occurredAt: '2026-06-14T00:00:00.000Z',
    });
    await waitFor(() => responses.join('').includes('backend/event/notify'));

    expect(JSON.parse(responses.join(''))).toStrictEqual({
      jsonrpc: '2.0',
      method: 'backend/event/notify',
      params: {
        seq: 1,
        type: 'snapshot.updated',
        payload,
        occurredAt: '2026-06-14T00:00:00.000Z',
      },
    });
    socket.destroy();
  });

  it('can send backend-initiated requests to the connected client', async () => {
    const socketPath = await tempSocketPath();
    server = new LocalSocketRpcServer({
      socketPath,
      onMessage: () => undefined,
    });
    await server.start();
    const socket = await connect(socketPath);
    let requestId: string | null = null;
    socket.on('data', (chunk) => {
      const message = JSON.parse(chunk.toString()) as { id: string; method: string };
      requestId = message.id;
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: true })}\n`);
    });

    await expect(server.requestFirstClient('client/external/open', { url: 'https://example.com' })).resolves.toBe(true);
    expect(requestId).toMatch(/^backend-/);
    socket.destroy();
  });

  it('finds the collaboration controller when another client connected first and reports its absence', async () => {
    const socketPath = await tempSocketPath();
    server = new LocalSocketRpcServer({ socketPath, onMessage: () => undefined });
    await server.start();
    const desktop = await connect(socketPath);
    const controller = await connect(socketPath);
    const respond = (socket: net.Socket, result: boolean) => socket.on('data', chunk => {
      for (const line of chunk.toString().trim().split('\n')) {
        const message = JSON.parse(line);
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: result ? { ownerId: 'owner', result: { content: [] } } : null })}\n`);
      }
    });
    respond(desktop, false);
    respond(controller, true);
    try {
      await expect(server.requestCollaborationController({ ownerId: 'owner' })).resolves.toStrictEqual({ ownerId: 'owner', result: { content: [] } });
      controller.destroy();
      await waitFor(() => controller.closed);
      await expect(server.requestCollaborationController({ ownerId: 'owner' })).rejects.toThrow('controller');
    } finally { desktop.destroy(); controller.destroy(); }
  });
});

async function tempSocketPath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'daemon-socket-test-'));
  return path.join(dir, 'daemon.sock');
}

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for predicate.');
}
