import { describe, expect, it } from 'vitest';
import { encodeConversationInvitation, decodeConversationInvitation, encodeConversationShareLink, decodeConversationShareLink } from '../conversation-sharing';
import { product } from '../product';

const relay = product.companionRelay;
const uuid = 'd83463c0-2445-4c27-8663-349ba222a931';
// Invite parsing is the pre-network boundary: only a UUIDv4 or the exact short
// app link is accepted; routing metadata and malformed input fail closed.
describe('conversation share deep links', () => {
  it('uses the same UUIDv4 for the pasteable invitation and short link without leaking routing metadata', () => {
    const link = decodeConversationInvitation(uuid, relay)!;
    expect(link).toMatchObject({ relay, credential: uuid });
    expect(link.ownerId).toBeUndefined();
    expect(link.handle).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(link.handle).not.toBe(uuid.replaceAll('-', ''));
    expect(encodeConversationInvitation(link)).toBe(uuid);
    const encoded = `${product.protocolScheme}://share/${uuid}`;
    expect(encodeConversationShareLink(link)).toBe(encoded);
    expect(decodeConversationShareLink(encoded, relay)).toStrictEqual(link);
    expect(decodeConversationInvitation(` ${uuid.toUpperCase()} `, relay)).toStrictEqual(link);
    expect(decodeConversationInvitation(encoded, relay)).toStrictEqual(link);
  });
  it('rejects non-v4 UUIDs and ambiguous links before networking', () => {
    const url = `${product.protocolScheme}://share/${uuid}`;
    for (const value of ['garbage', uuid.replace('-4c27-', '-7c27-'), uuid.replace('-8663-', '-7663-'), url + '/extra', url + '?relay=wss://evil.example', url + '#credential=secret', url.replace('share/', 'other/'), url + 'x'.repeat(4096)]) {
      expect(decodeConversationInvitation(value, relay)).toBeNull();
    }
    expect(() => encodeConversationInvitation({ ...decodeConversationInvitation(uuid, relay)!, credential: 'secret' })).toThrow();
  });
});
