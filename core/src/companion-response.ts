import { companionDecodedResponseLimit, companionResponseLimit, decodeCompanionPayload, CompanionFrameDecoder } from './companion-protocol';

type Source = AsyncIterable<Uint8Array | { subarray(): Uint8Array }>;

/** Both legacy JSON and negotiated gzip use the same bounded wire framing. */
export async function* readCompanionResponses(source: Source): AsyncGenerator<unknown> {
  const decoder = new CompanionFrameDecoder(companionResponseLimit, payload => payload);
  for await (const chunk of source) {
    for (const payload of decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())) yield await decodeResponse(payload as Uint8Array);
  }
}
export async function readFirstCompanionResponse(source: Source): Promise<unknown> {
  for await (const value of readCompanionResponses(source)) return value;
  throw new Error('Stream closed without a frame.');
}
async function decodeResponse(payload: Uint8Array): Promise<unknown> {
  if (payload[0] !== 0x1f || payload[1] !== 0x8b) return decodeCompanionPayload(payload);
  const reader = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > companionDecodedResponseLimit) throw new Error('Companion response too large.');
      chunks.push(next.value);
    }
    const decoded = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.byteLength; }
    return decodeCompanionPayload(decoded);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
