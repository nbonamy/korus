import type { Connection, Libp2p } from '@libp2p/interface';

/** How often every connection is asked for a yamux pong, and how long it may stay silent before it is cut. */
const checkIntervalMs = 10_000;
const silentLimitMs = 30_000;

type Muxed = Connection & { muxer?: { ping?(): Promise<unknown> } };
type Log = (message: string, details: Record<string, unknown>) => void;

/**
 * The relay's own liveness policy, in place of libp2p's monitor, which aborts on the first ping slower than a few seconds:
 * a slow answer is waited for, and only a connection silent for thirty seconds is cut. A ping is never abandoned, because
 * yamux treats the pong of an abandoned ping as a protocol error and kills the connection with every circuit on it.
 * A peer that reconnects supersedes its older connections at once, so a phone is never routed over a laptop's dead link
 * while that link waits out its silence. Every cut and close is logged with its reason.
 */
export class RelayConnections {
  private readonly pinging = new Map<string, number>();
  private readonly reasons = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly node: Pick<Libp2p, 'getConnections' | 'addEventListener'>, private readonly role: (peer: string) => string, private readonly log: Log) {}

  start() {
    this.node.addEventListener('connection:open', (event) => { this.supersede(event.detail); });
    this.node.addEventListener('connection:close', (event) => { this.closed(event.detail); });
    this.timer = setInterval(() => { this.check(); }, checkIntervalMs);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); this.timer = undefined; }

  private check() {
    const now = Date.now();
    for (const connection of this.node.getConnections() as Muxed[]) {
      const ping = connection.muxer?.ping;
      if (!ping || connection.status !== 'open' || this.reasons.has(connection.id)) continue;
      const since = this.pinging.get(connection.id);
      if (since === undefined) {
        this.pinging.set(connection.id, now);
        // A closed muxer rejects; the close event that follows reaps the entry.
        ping.call(connection.muxer).then(() => { if (this.pinging.get(connection.id) === now) this.pinging.delete(connection.id); }, () => {});
      } else if (now - since >= silentLimitMs) this.cut(connection, 'unresponsive', { silentMs: now - since });
    }
  }

  private supersede(fresh: Connection) {
    for (const connection of this.node.getConnections(fresh.remotePeer)) if (connection.id !== fresh.id && !this.reasons.has(connection.id)) this.cut(connection, 'superseded');
  }

  private cut(connection: Connection, reason: string, details: Record<string, unknown> = {}) {
    this.reasons.set(connection.id, reason);
    this.log('relay connection cut', { role: this.role(connection.remotePeer.toString()), reason, aliveMs: Date.now() - connection.timeline.open, ...details });
    connection.abort(new Error(`Relay connection ${reason}.`));
  }

  private closed(connection: Connection) {
    this.log('relay connection closed', { role: this.role(connection.remotePeer.toString()), aliveMs: Date.now() - connection.timeline.open, reason: this.reasons.get(connection.id) ?? 'remote' });
    this.pinging.delete(connection.id); this.reasons.delete(connection.id);
  }
}
