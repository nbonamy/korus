import { describe, expect, it } from 'vitest';
import { encodeConversationShareLink, decodeConversationShareLink } from '../conversation-sharing';
import { product } from '../product';

const relay = product.companionRelay!;
const link = { v: 1 as const, relay, ownerId: '12D3KooWJ7cStPD8Mq1nJKegq5nTXWmKkRZAfkQxBBDQvhfHE3Ej', handle: 'a'.repeat(32), credential: 'b'.repeat(43) };
// The codec is the pre-network trust boundary: arbitrary relays, pin swaps,
// ambiguous fields, oversized input and unsupported versions must fail closed.
describe('conversation share deep links', () => {
  it('round trips a canonical reusable link against the configured relay', () => {
    const encoded = encodeConversationShareLink(link);
    expect(decodeConversationShareLink(encoded, relay)).toStrictEqual(link);
    expect(encodeConversationShareLink(decodeConversationShareLink(encoded, relay)!)).toBe(encoded);
  });
  it('rejects malformed or unsupported links before networking without leaking input', () => {
    const encoded = encodeConversationShareLink(link);
    for (const value of [encoded.replace('v=1', 'v=2'), encoded + '&unexpected=secret', encoded.replace('handle=', 'extra='), encoded.replace(link.credential, 'short'), encoded + 'x'.repeat(4096), encoded.replace('share?', 'other?'), encoded.replace('v=1', 'v=1&v=1'), 'garbage']) {
      expect(decodeConversationShareLink(value, relay)).toBeNull();
    }
    expect(decodeConversationShareLink(encoded, { ...relay, origin: 'wss://untrusted.example' })).toBeNull();
    expect(decodeConversationShareLink(encoded, { ...relay, peerId: link.ownerId })).toBeNull();
    expect(() => encodeConversationShareLink({ ...link, credential: 'secret' })).toThrow('Invalid conversation share link');
  });
});
