import type { Libp2p, Stream } from '@libp2p/interface';
import { z } from 'zod';
import { shareAdmissionFrameLimit, shareAdmissionProtocol, shareDirectoryCapacity, shareGuestProtocol, type ShareRoutingStatus } from '@workspace/core/conversation-share-relay';
import { companionFrameLimit, companionResponseLimit, encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import type { RelayLink } from '../companion/relay-link';
import { sendWithBackpressure } from '../companion/stream-io';

export type ShareOwnerOptions = {
  handles(): string[];
  status?(status: ShareRoutingStatus): void;
  /** Dedicated application gateway. A circuit/handle is never application authorization. */
  accept?(stream: Stream, peerId: string): Promise<void>;
};
const answer = z.object({ v: z.literal(2), status: z.enum(['ready', 'unavailable', 'capacity', 'rateLimited', 'upgradeRequired']) }).strict();
export const unsupportedShareProtocol = (error: unknown) => error instanceof Error && error.name === 'UnsupportedProtocolError';

/** Uses the existing owner reservation, without installing any phone control API. */
export class ShareOwnerTransport {
  private work: Promise<unknown> = Promise.resolve();
  private readonly streams = new Set<Stream>();
  constructor(private readonly link: RelayLink, private readonly options: ShareOwnerOptions) {}
  async attach(node: Libp2p) {
    const accept = this.options.accept;
    if (!accept) return; // Missing guest gateway negotiates upgrade-required, never phone fallback.
    await node.handle(shareGuestProtocol, async (stream, connection) => {
      stream.maxReadBufferLength = companionFrameLimit + 4;
      stream.maxWriteBufferLength = companionResponseLimit + 4;
      stream.inactivityTimeout = 30_000;
      this.streams.add(stream);
      try { await accept(stream, connection.remotePeer.toString()); }
      catch { stream.abort(new Error('Guest connection unavailable.')); }
      finally { this.streams.delete(stream); }
    }, { maxInboundStreams: 2, maxOutboundStreams: 1, runOnLimitedConnection: true });
  }
  advertise(): Promise<ShareRoutingStatus> {
    const run = this.work.then(() => this.send(), () => this.send());
    this.work = run;
    return run;
  }
  disconnected() { this.options.status?.('unavailable'); }
  stop() {
    for (const stream of this.streams) stream.abort(new Error('Guest transport stopped.'));
    this.streams.clear();
    this.disconnected();
  }
  private async send(): Promise<ShareRoutingStatus> {
    let status: ShareRoutingStatus = 'unavailable';
    if (this.link.connected) try {
      const desired = this.options.handles();
      // Preserve saved creation order: overflow cannot rotate existing links out
      // of routing. Freed slots admit the next saved handle on renewal.
      const handles = desired.slice(0, shareDirectoryCapacity);
      const stream = await this.link.dialRelay(shareAdmissionProtocol, 10_000);
      try {
        stream.maxReadBufferLength = 4096; stream.maxWriteBufferLength = shareAdmissionFrameLimit + 4;
        stream.inactivityTimeout = 10_000;
        await sendWithBackpressure(stream, encodeCompanionFrame({ v: 2, handles }));
        await stream.close({ signal: AbortSignal.timeout(5000) });
        status = answer.parse(await readFirstCompanionFrame(stream, 4096)).status;
        if (status === 'ready' && desired.length > handles.length) status = 'capacity';
      } finally { stream.abort(new Error('Guest routing request finished.')); }
    } catch (error) { status = unsupportedShareProtocol(error) ? 'upgradeRequired' : 'unavailable'; }
    this.options.status?.(status);
    return status;
  }
}
