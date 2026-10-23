import type { Libp2p, Stream } from '@libp2p/interface';
import {
  companionBackgroundIdleTimeoutMs, companionCompressedProtocol, companionCompressedUpdatesProtocol, companionFrameLimit, companionProtocol,
  companionResponseLimit, companionUpdatesProtocol, encodeCompanionFrame, readCompanionFrames, readFirstCompanionFrame,
} from '@workspace/core/companion-protocol';
import { z } from 'zod';
import { logMain, warnMain } from '../log';
import { describeError } from './describe-error';
import type { CompanionGateway } from './gateway';
import { encodeCompanionResponse } from './response';
import { sendWithBackpressure } from './stream-io';
import { UpdateStreamWriter } from './update-writer';

const requestSchema = z.object({ v: z.literal(1), id: z.string().uuid(), method: z.string().min(1).max(80), args: z.unknown() }).strict();
const oneShotIdleTimeoutMs = 30_000;
const closeTimeoutMs = 5_000;
const denied = 'Operation denied or unavailable.';

type Kind = 'request' | 'updates';
// The relay circuit counts as a limited connection, so every handler must opt in to run on it.
const handlers: { protocol: string; kind: Kind; compressed: boolean }[] = [
  { protocol: companionProtocol, kind: 'request', compressed: false },
  { protocol: companionUpdatesProtocol, kind: 'updates', compressed: false },
  { protocol: companionCompressedProtocol, kind: 'request', compressed: true },
  { protocol: companionCompressedUpdatesProtocol, kind: 'updates', compressed: true },
];

/** Serves the paired phones' streams: one-shot requests and the long-lived update channel. */
export class StreamServer {
  private readonly open = new Map<string, Set<Stream>>();
  // A phone holds one update channel; an older one is a dead socket the laptop has not noticed yet.
  private readonly updates = new Map<string, Stream>();

  /** `claimed` runs after a pairing claim is accepted and before the phone is answered, so the relay routes the new invitation first. */
  constructor(private readonly gateway: CompanionGateway, private readonly claimed: () => Promise<unknown>) {}

  async attach(node: Libp2p) {
    for (const { protocol, kind, compressed } of handlers) {
      await node.handle(protocol, (stream, connection) => this.track(stream, connection.remotePeer.toString(),
        kind === 'request' ? (s, peer) => this.serve(s, peer, compressed) : (s, peer) => this.serveUpdates(s, peer, compressed)),
      { maxInboundStreams: kind === 'request' ? 4 : 1, maxOutboundStreams: 1, runOnLimitedConnection: true });
    }
  }

  /** Revocation and shutdown abort every stream a device holds. */
  abort(peerId: string, reason: string) { for (const stream of this.open.get(peerId) ?? []) stream.abort(new Error(reason)); }

  abortAll(reason: string) {
    for (const streams of this.open.values()) for (const stream of streams) stream.abort(new Error(reason));
    this.open.clear(); this.updates.clear();
  }

  private track(stream: Stream, peerId: string, run: (stream: Stream, peerId: string) => Promise<void>) {
    const streams = this.open.get(peerId) ?? new Set<Stream>();
    streams.add(stream); this.open.set(peerId, streams);
    run(stream, peerId).catch(() => {}).finally(() => {
      streams.delete(stream);
      if (!streams.size && this.open.get(peerId) === streams) this.open.delete(peerId);
    });
  }

  private async serve(stream: Stream, peerId: string, compressed: boolean) {
    stream.maxReadBufferLength = companionFrameLimit + 4;
    stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = oneShotIdleTimeoutMs;
    try {
      const request = requestSchema.parse(await readFirstCompanionFrame(stream));
      let response;
      try {
        const result = await this.gateway.request(peerId, request.method, request.args);
        if (request.method === 'pair.claim') await this.claimed();
        response = encodeCompanionResponse({ v: 1, id: request.id, result }, compressed);
      } catch (error) {
        warnMain('companion', 'request denied', { method: request.method, error: describeError(error) });
        response = encodeCompanionFrame({ v: 1, id: request.id, error: denied });
      }
      if (stream.status !== 'open') return;
      await sendWithBackpressure(stream, response);
      await stream.close({ signal: AbortSignal.timeout(closeTimeoutMs) });
    } catch (error) {
      warnMain('companion', 'request invalid', { error: describeError(error) });
      stream.abort(new Error('Invalid companion request.'));
    }
  }

  private async serveUpdates(stream: Stream, peerId: string, compressed: boolean) {
    stream.maxReadBufferLength = companionFrameLimit + 4;
    stream.maxWriteBufferLength = companionResponseLimit + 4;
    stream.inactivityTimeout = companionBackgroundIdleTimeoutMs;
    this.updates.get(peerId)?.abort(new Error('Replaced by a newer update channel.'));
    this.updates.set(peerId, stream);
    let sequence = 0; let closed = false;
    const started = Date.now(); let requestStarted = started; let method = ''; let requestId = '';
    const writer: UpdateStreamWriter = new UpdateStreamWriter({ write: (bytes) => sendWithBackpressure(stream, bytes), fail: (reason, detail) => fail(reason, detail) });
    const diagnostic = () => ({ streamId: stream.id, elapsedMs: Date.now() - started, method, requestId,
      requestAgeMs: method ? Date.now() - requestStarted : 0, sequence, queuedBytes: writer.queuedBytes, queuedFrames: writer.queuedFrames });
    logMain('companion', 'updates opened', diagnostic());
    const fail = (reason: string, detail?: string) => {
      if (!closed) warnMain('companion', 'updates failed', { ...diagnostic(), reason, ...(detail ? { error: detail } : {}) });
      closed = true; writer.close(); stream.abort(new Error('Companion update stream closed.'));
    };
    const send = (value: unknown) => {
      if (closed) return;
      let bytes: Uint8Array;
      try { bytes = encodeCompanionResponse(value, compressed); } catch (error) { fail('encode-failed', describeError(error)); return; }
      writer.enqueue(bytes);
    };
    let subscription: ReturnType<CompanionGateway['subscribe']> | undefined;
    let loggedClose = false;
    const cleanup = () => {
      if (!loggedClose) { logMain('companion', 'updates closed', diagnostic()); loggedClose = true; }
      closed = true; writer.close(); subscription?.close();
      if (this.updates.get(peerId) === stream) this.updates.delete(peerId);
    };
    stream.addEventListener('close', cleanup, { once: true });
    try {
      // The subscription's replay awaits the writer, so a long catch-up is paced instead of overrunning the queue.
      subscription = this.gateway.subscribe(peerId, (update) => { send({ v: 1, seq: ++sequence, update }); return writer.drained(); }, () => fail('subscription-failed'));
      for await (const value of readCompanionFrames(stream)) {
        const request = requestSchema.parse(value);
        method = request.method; requestId = request.id; requestStarted = Date.now();
        logMain('companion', 'updates request', diagnostic());
        try {
          const result = await subscription.request(request.method, request.args);
          send({ v: 1, id: request.id, result });
          logMain('companion', 'updates reply', diagnostic());
        } catch (error) {
          warnMain('companion', 'updates operation denied', { ...diagnostic(), error: describeError(error) });
          send({ v: 1, id: request.id, error: denied });
        } finally { method = ''; requestId = ''; }
      }
    } catch (error) { fail('receive-failed', describeError(error)); }
    finally { logMain('companion', 'updates ended', diagnostic()); cleanup(); stream.removeEventListener('close', cleanup); stream.abort(new Error('Updates ended.')); }
  }
}
