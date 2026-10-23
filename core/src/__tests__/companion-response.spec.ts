import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { companionDecodedResponseLimit, companionResponseLimit, encodeCompanionPayload } from '../companion-protocol';
import { readFirstCompanionResponse } from '../companion-response';

async function* fragmented(payload: Uint8Array) {
  const wire = encodeCompanionPayload(payload, companionResponseLimit);
  yield wire.subarray(0, 7); yield wire.subarray(7);
}

describe('compressed companion response safety', () => {
  it('rejects expansion beyond the decoded bound even when the compressed frame fits the wire bound', async () => {
    const payload = gzipSync(Buffer.alloc(companionDecodedResponseLimit + 1, 32));
    expect(payload.byteLength).toBeLessThan(companionResponseLimit);
    await expect(readFirstCompanionResponse(fragmented(payload))).rejects.toThrow('response too large');
  });

  it.each([
    ['broken gzip', new Uint8Array([0x1f, 0x8b, 0, 0])],
    ['non-JSON contents', gzipSync(Buffer.from('{'))],
    ['invalid UTF-8', gzipSync(new Uint8Array([0x22, 0xff, 0x22]))],
  ])('rejects %s instead of delivering a provider payload', async (_name, payload) => {
    await expect(readFirstCompanionResponse(fragmented(payload))).rejects.toThrow();
  });

  it('reports a missing response when the peer closes before sending a frame', async () => {
    async function* closed() { /* No response received. */ }
    await expect(readFirstCompanionResponse(closed())).rejects.toThrow('closed without a frame');
  });
});
