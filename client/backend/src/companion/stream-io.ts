import type { Stream } from '@libp2p/interface';

/** Resolves once the stream has accepted the bytes; rejects if it closes first. */
export async function sendWithBackpressure(stream: Stream, bytes: Uint8Array): Promise<void> {
  if (stream.send(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { stream.removeEventListener('close', close); stream.removeEventListener('drain', drain); };
    const close = () => { cleanup(); reject(new Error('Closed.')); };
    const drain = () => { cleanup(); resolve(); };
    stream.addEventListener('close', close, { once: true }); stream.addEventListener('drain', drain, { once: true });
  });
}
