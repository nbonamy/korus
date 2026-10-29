import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { mkdir, unlink } from 'node:fs/promises';
import net, { type Server, type Socket } from 'node:net';
import path from 'node:path';
import type { AppBackendEvent, AppRpcMessage, AppRpcResponse } from '@workspace/core/backend-protocol/rpc';
import { StdioRpcPeer } from './stdio';
import { isRemoteCollaborationReply } from '@workspace/core/remote-collaboration';

export type LocalSocketRpcServerOptions = {
  onMessage(message: AppRpcMessage): AppRpcResponse | undefined | Promise<AppRpcResponse | undefined>;
  socketPath: string;
};

export class LocalSocketRpcServer {
  private server: Server | null = null;
  private readonly peers = new Set<StdioRpcPeer>();

  constructor(private readonly options: LocalSocketRpcServerOptions) {}

  async start(): Promise<void> {
    await mkdir(path.dirname(this.options.socketPath), { recursive: true, mode: 0o700 });
    await removeStaleSocket(this.options.socketPath);

    const server = net.createServer((socket) => this.handleConnection(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const peer of this.peers) {
      peer.stop();
    }
    this.peers.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    await unlink(this.options.socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  broadcastEvent(event: AppBackendEvent): void {
    for (const peer of this.peers) {
      peer.notify(backendMethods.backendEventNotify, event);
    }
  }

  async requestFirstClient<Result>(method: string, params?: unknown): Promise<Result> {
    const peer = this.peers.values().next().value as StdioRpcPeer | undefined;
    if (!peer) {
      throw new Error(`No connected client can handle '${method}'.`);
    }
    return peer.request<Result>(method, params);
  }

  async requestCollaborationController<Result>(params: unknown): Promise<Result> {
    // Only the owning controller accepts the team identity; desktops and unrelated controllers reject it.
    try {
      const ownerId = params && typeof params === 'object' && 'ownerId' in params ? params.ownerId : undefined;
      return await Promise.any([...this.peers].map(async peer => {
        const reply = await peer.request<Result>(backendMethods.clientCollaborationCall, params);
        if (!isRemoteCollaborationReply(reply, ownerId)) throw new Error('This client is not the collaboration controller.');
        return reply;
      }));
    } catch {
      throw new Error('The collaboration controller is not connected. Reconnect the controlling computer and retry.');
    }
  }

  private handleConnection(socket: Socket): void {
    const peer = new StdioRpcPeer({
      input: socket,
      output: socket,
      onMessage: this.options.onMessage,
    });
    this.peers.add(peer);
    socket.once('close', () => {
      peer.stop();
      this.peers.delete(peer);
    });
    socket.once('error', () => {
      peer.stop();
      this.peers.delete(peer);
    });
    peer.start();
  }
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  const isActive = await canConnect(socketPath);
  if (isActive) {
    throw new Error(`daemon socket is already in use: ${socketPath}`);
  }

  await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
