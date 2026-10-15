import type { Stream } from '@libp2p/interface';
import { companionFrameLimit, companionResponseLimit, encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';

/** One request on an already authenticated laptop stream. */
export async function requestCompanionStream<Result>(stream: Stream, method: string, args: unknown): Promise<Result> {
  stream.maxReadBufferLength = companionResponseLimit + 4;
  stream.maxWriteBufferLength = companionFrameLimit + 4;
  stream.inactivityTimeout = 20_000;
  const id = crypto.randomUUID();
  try {
    stream.send(encodeCompanionFrame({ v: 1, id, method, args }));
    await stream.close({ signal: AbortSignal.timeout(5000) });
    const value = await readFirstCompanionFrame(stream, companionResponseLimit);
    if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('id' in value) || value.id !== id) throw new Error('Invalid companion response.');
    if ('error' in value) throw new Error('Laptop denied the operation or is unavailable.');
    if (!('result' in value)) throw new Error('Invalid companion result.');
    return value.result as Result;
  } finally { stream.abort(new Error('Request complete.')); }
}
