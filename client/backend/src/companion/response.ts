import { gzipSync } from 'node:zlib';
import { companionDecodedResponseLimit, companionResponseLimit, encodeCompanionFrame, encodeCompanionPayload } from '@workspace/core/companion-protocol';

/** Serialize before enqueueing, so later provider mutations cannot change a queued response. */
export function encodeCompanionResponse(value: unknown, compressed: boolean): Uint8Array {
  if (!compressed) return encodeCompanionFrame(value, companionResponseLimit);
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.byteLength > companionDecodedResponseLimit) throw new Error('Companion response too large.');
  // Small replies retain the legacy representation; large screenshots stay whole.
  return encodeCompanionPayload(payload.byteLength < 256 * 1024 ? payload : gzipSync(payload), companionResponseLimit);
}
