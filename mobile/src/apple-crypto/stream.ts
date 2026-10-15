import { AbstractMessageStream } from '@libp2p/utils';
import type { AbortOptions, MessageStream } from '@libp2p/interface';
import { Uint8ArrayList } from 'uint8arraylist';
import { uint16BEEncode } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/encoder.js';
import { appleCrypto, decode, encode } from './bridge';

/** Ordered, bounded batches across the asynchronous WK bridge. Noise retains record counters natively. */
export class AppleEncryptedStream extends AbstractMessageStream {
  private readonly incoming = new Uint8ArrayList();
  // One partial Noise record may precede a coalesced transport buffer.
  private readonly readLimit = 4 * 1024 * 1024 + 65537;
  private reading = Promise.resolve();
  private pumping = false;
  private transportEnded = false;
  private transportClosed = false;
  private transportPaused = false;
  private writing = Promise.resolve();
  private released = false;
  constructor(private readonly transport: MessageStream, private readonly id: string) {
    super({ log: transport.log, direction: transport.direction, inactivityTimeout: transport.inactivityTimeout,
      maxReadBufferLength: transport.maxReadBufferLength, maxWriteBufferLength: 4 * 1024 * 1024, maxMessageSize: 4 * 65519 });
    transport.addEventListener('message', event => {
      if (this.released) return;
      if (event.data instanceof Uint8Array) this.incoming.append(event.data);
      else for (const bytes of event.data) this.incoming.append(bytes);
      if (this.incoming.byteLength > this.readLimit) { this.abort(new Error('Encrypted read buffer exceeded')); return; }
      this.pump();
    });
    transport.addEventListener('close', event => {
      if (event.error) { this.abort(event.error); return; }
      this.transportClosed = true;
      this.pump();
    });
    transport.addEventListener('remoteCloseWrite', () => { this.transportEnded = true; this.pump(); });
  }
  private pump() {
    if (this.pumping || this.released) return;
    this.pumping = true;
    this.reading = Promise.resolve().then(async () => {
      try {
        while (!this.released) {
          if (this.readStatus === 'paused') { this.pauseTransport(); return; }
          const records: string[] = [];
          while (records.length < 16 && this.incoming.byteLength >= 2) {
            const length = this.incoming.getUint16(0);
            if (length < 16) throw new Error('Invalid encrypted record length');
            if (this.incoming.byteLength < length + 2) break;
            records.push(encode(this.incoming.subarray(2, length + 2)));
            this.incoming.consume(length + 2);
          }
          if (records.length) {
            this.pauseTransport();
            const result = await appleCrypto<{ records: string[] }>({ op: 'decrypt', id: this.id, records });
            if (this.released) return;
            for (const record of result.records) this.onData(decode(record));
            continue;
          }
          if (this.transportClosed || this.transportEnded) {
            if (this.incoming.byteLength) throw new Error('Truncated encrypted record');
            if (this.transportClosed) { this.onTransportClosed(); this.release(); }
            else this.onRemoteCloseWrite();
            return;
          }
          if (this.transportPaused && this.transport.status === 'open') {
            const previous = this.incoming.byteLength;
            // resume() dispatches buffered messages synchronously before sendResume().
            // Only this pump changes flow control, after that callback has returned.
            this.transportPaused = false;
            this.transport.resume();
            if (this.incoming.byteLength !== previous) { this.pauseTransport(); continue; }
          }
          return;
        }
      } finally {
        this.pumping = false;
      }
    }).catch(error => this.abort(error));
  }
  private pauseTransport() {
    if (this.transport.status === 'open' && !this.transportPaused) {
      this.transportPaused = true;
      this.transport.pause();
    }
  }
  private release() {
    if (this.released) return;
    this.released = true;
    this.incoming.consume(this.incoming.byteLength);
    void Promise.all([this.reading, this.writing]).then(() => appleCrypto({ op: 'close', id: this.id })).catch(() => {});
  }
  sendData(data: Parameters<AbstractMessageStream['sendData']>[0]) {
    const records: string[] = [];
    for (let offset = 0; offset < data.byteLength; offset += 65519) records.push(encode(data.subarray(offset, Math.min(data.byteLength, offset + 65519))));
    this.writing = appleCrypto<{ records: string[] }>({ op: 'encrypt', id: this.id, records }).then(async result => {
      if (this.released) return;
      const framed = new Uint8ArrayList();
      for (const record of result.records) { const bytes = decode(record); framed.append(uint16BEEncode(bytes.length), bytes); }
      if (!this.transport.send(framed.subarray())) await this.transport.onDrain();
      this.safeDispatchEvent('drain');
    }).catch(error => this.abort(error));
    return { sentBytes: data.byteLength, canSendMore: false };
  }
  sendPause() { this.pauseTransport(); }
  sendResume() { this.pump(); }
  sendReset(error: Error) { this.transport.abort(error); this.release(); }
  async close(options?: AbortOptions) {
    this.writeStatus = 'closing';
    while (this.writableNeedsDrain || this.writeBufferLength) { await this.onDrain(options); options?.signal?.throwIfAborted(); }
    await this.writing;
    await this.transport.close(options);
  }
}
