import { describe, expect, it } from 'vitest';
import { CompanionFrameDecoder, companionFrameLimit, encodeCompanionFrame } from '../companion-protocol';

describe('companion wire framing', () => {
  it('decodes fragmented and coalesced UTF-8 frames without changing provider payloads', () => {
    const value = { id: 'one', payload: { text: 'été', revision: 3 } };
    const first = encodeCompanionFrame(value);
    const second = encodeCompanionFrame({ id: 'two' });
    const decoder = new CompanionFrameDecoder();
    expect(decoder.push(first.slice(0, 6))).toStrictEqual([]);
    const rest = new Uint8Array(first.length - 6 + second.length);
    rest.set(first.slice(6)); rest.set(second, first.length - 6);
    expect(decoder.push(rest)).toStrictEqual([value, { id: 'two' }]);
  });
  it('rejects oversized frames before accepting payload bytes and rejects malformed JSON', () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, companionFrameLimit + 1);
    expect(() => new CompanionFrameDecoder().push(header)).toThrow('length');
    expect(() => encodeCompanionFrame('x'.repeat(companionFrameLimit))).toThrow('large');
    expect(() => new CompanionFrameDecoder().push(new Uint8Array([0, 0, 0, 1, 33]))).toThrow();
  });
});
