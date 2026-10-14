import { AbstractMessageStream, LengthPrefixedDecoder } from '@libp2p/utils';
import type { AbortOptions, MessageStream } from '@libp2p/interface';
import { Uint8ArrayList } from 'uint8arraylist';
import { uint16BEDecode, uint16BEEncode } from '../../../node_modules/@chainsafe/libp2p-noise/dist/src/encoder.js';
import { appleCrypto, decode, encode } from './bridge';

/** Ordered, bounded batches across the asynchronous WK bridge. Noise retains record counters natively. */
export class AppleEncryptedStream extends AbstractMessageStream {
  private readonly decoder = new LengthPrefixedDecoder({ lengthDecoder: data => uint16BEDecode(data.subarray()), maxBufferSize: 4 * 1024 * 1024, encodingLength: () => 2 });
  private reading = Promise.resolve();
  private writing = Promise.resolve();
  private queuedRead = 0;
  private released = false;
  private cryptoPaused = false;
  constructor(private readonly transport: MessageStream, private readonly id: string) {
    super({ log: transport.log, direction: transport.direction, inactivityTimeout: transport.inactivityTimeout,
      maxReadBufferLength: transport.maxReadBufferLength, maxWriteBufferLength: 4 * 1024 * 1024, maxMessageSize: 4 * 65519 });
    transport.addEventListener('message', event => {
      try {
        const records = [...this.decoder.decode(event.data)].map(record => record.subarray());
        this.queuedRead += records.reduce((sum, record) => sum + record.length, 0);
        if (this.queuedRead > 4 * 1024 * 1024) throw new Error('Encrypted read buffer exceeded');
        if (this.queuedRead >= 256 * 1024 && !this.cryptoPaused) { this.cryptoPaused = true; this.transport.pause(); }
        for (let index = 0; index < records.length; index += 16) {
          const batch = records.slice(index, index + 16);
          this.reading = this.reading.then(async () => {
            if (this.released) return;
            const result = await appleCrypto<{ records: string[] }>({ op: 'decrypt', id, records: batch.map(encode) });
            this.queuedRead -= batch.reduce((sum, record) => sum + record.length, 0);
            if (!this.released) {
              for (const record of result.records) this.onData(decode(record));
              if (this.cryptoPaused && this.queuedRead < 128 * 1024) {
                this.cryptoPaused = false;
                if (this.readStatus === 'readable' && this.transport.status === 'open') this.transport.resume();
              }
            }
          }).catch(error => this.abort(error));
        }
      } catch (error) { this.abort(error as Error); }
    });
    transport.addEventListener('close', event => {
      if (event.error) { this.abort(event.error); return; }
      void this.reading.then(() => { this.onTransportClosed(); this.release(); });
    });
    transport.addEventListener('remoteCloseWrite', () => { void this.reading.then(() => this.onRemoteCloseWrite()); });
  }
  private release() {
    if (this.released) return;
    this.released = true;
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
  sendPause() { this.transport.pause(); }
  sendResume() { if (!this.cryptoPaused) this.transport.resume(); }
  sendReset(error: Error) { this.transport.abort(error); this.release(); }
  async close(options?: AbortOptions) {
    this.writeStatus = 'closing';
    while (this.writableNeedsDrain || this.writeBufferLength) { await this.onDrain(options); options?.signal?.throwIfAborted(); }
    await this.writing;
    await this.transport.close(options);
  }
}
