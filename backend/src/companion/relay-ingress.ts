import { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Multiaddr } from '@multiformats/multiaddr';
import { WindowBudget, sourceNetwork } from './source-budget';

const normalize = (address: string) => address.replace(/^::ffff:/, '');
const socketKey = (address: Multiaddr) => {
  const parts = address.getComponents();
  return `${normalize(parts.find(part => part.name === 'ip4' || part.name === 'ip6')?.value ?? '')}:${parts.find(part => part.name === 'tcp')?.value}`;
};
/** Retains the HTTP upgrade's source until libp2p authenticates the same socket. */
export class RelayIngress {
  private readonly requests = new Map<string, IncomingMessage>();
  private readonly active = new Map<string, string>();
  private readonly connections: WindowBudget;
  readonly IncomingMessage: typeof IncomingMessage;
  constructor(private readonly trustedProxy = false, now = Date.now) {
    this.connections = new WindowBudget(60, 60_000, 10_000, now);
    const requests = this.requests; const active = this.active;
    this.IncomingMessage = class extends IncomingMessage {
      constructor(socket: Socket) {
        super(socket);
        const key = `${normalize(socket.remoteAddress ?? '')}:${socket.remotePort}`;
        requests.set(key, this);
        socket.once('close', () => { if (requests.get(key) === this) requests.delete(key); active.delete(key); });
      }
    };
  }
  /** The client network that every source limit counts against. */
  source(address: Multiaddr): string | undefined {
    const key = socketKey(address);
    const ip = key.slice(0, key.lastIndexOf(':'));
    if (!this.trustedProxy) return sourceNetwork(ip);
    if (ip !== '127.0.0.1' && ip !== '::1') return;
    const header = this.requests.get(key)?.headers['x-real-ip'];
    // Exactly one address, overwritten by our loopback proxy. Never trust a forwarded list.
    return typeof header === 'string' ? sourceNetwork(header) : undefined;
  }
  admit(address: Multiaddr): boolean {
    const source = this.source(address);
    if (!source || [...this.active.values()].filter(value => value === source).length >= 20 || !this.connections.take(source)) {
      this.requests.get(socketKey(address))?.socket.destroy();
      return false;
    }
    this.active.set(socketKey(address), source);
    return true;
  }
}
