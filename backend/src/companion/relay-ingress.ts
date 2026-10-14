import { IncomingMessage } from 'node:http';
import { isIP, type Socket } from 'node:net';
import type { Multiaddr } from '@multiformats/multiaddr';

const normalize = (address: string) => address.replace(/^::ffff:/, '');
/** Retains the HTTP upgrade's source until libp2p authenticates the same socket. */
export class RelayIngress {
  private readonly requests = new Map<string, IncomingMessage>();
  private readonly active = new Map<string, string>();
  private readonly budgets = new Map<string, { until: number; count: number }>();
  readonly IncomingMessage: typeof IncomingMessage;
  constructor(private readonly trustedProxy = false, private readonly now = Date.now) {
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
  source(address: Multiaddr): string | undefined {
    const parts = address.getComponents();
    const ip = normalize(parts.find(part => part.name === 'ip4' || part.name === 'ip6')?.value ?? '');
    if (!isIP(ip)) return;
    if (!this.trustedProxy) return ip;
    if (ip !== '127.0.0.1' && ip !== '::1') return;
    const port = parts.find(part => part.name === 'tcp')?.value;
    const header = this.requests.get(`${ip}:${port}`)?.headers['x-real-ip'];
    // Exactly one address, overwritten by our loopback proxy. Never trust a forwarded list.
    return typeof header === 'string' && isIP(header) ? normalize(header) : undefined;
  }
  private deny(address: Multiaddr): false {
    const parts = address.getComponents();
    const ip = normalize(parts.find(part => part.name === 'ip4' || part.name === 'ip6')?.value ?? '');
    this.requests.get(`${ip}:${parts.find(part => part.name === 'tcp')?.value}`)?.socket.destroy();
    return false;
  }
  admit(address: Multiaddr): boolean {
    const source = this.source(address);
    if (!source) return this.deny(address);
    if ([...this.active.values()].filter(value => value === source).length >= 20) return this.deny(address);
    const now = this.now();
    for (const [key, budget] of this.budgets) if (budget.until <= now) this.budgets.delete(key);
    if (!this.budgets.has(source) && this.budgets.size >= 10_000) this.budgets.delete(this.budgets.keys().next().value!);
    const budget = this.budgets.get(source) ?? { until: now + 60_000, count: 0 };
    this.budgets.set(source, budget);
    if (++budget.count > 60) return this.deny(address);
    const parts = address.getComponents();
    const ip = normalize(parts.find(part => part.name === 'ip4' || part.name === 'ip6')?.value ?? '');
    this.active.set(`${ip}:${parts.find(part => part.name === 'tcp')?.value}`, source);
    return true;
  }
}
