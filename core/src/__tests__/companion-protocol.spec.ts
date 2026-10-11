import { describe, expect, it } from 'vitest';
import { CompanionFrameDecoder, companionFrameLimit, companionTarget, encodeCompanionFrame } from '../companion-protocol';
import type { Agent } from '../contracts';

describe('companion wire framing', () => {
  it('keeps a session target stable when private provider connection metadata changes', () => {
    const agent: Agent = { id: 'agent', teamId: 'team', name: 'Agent', backend: 'claude', folder: null,
      status: { type: 'idle' }, createdAt: '', updatedAt: '', backendSession: { kind: 'claude', sessionId: 'session', transport: 'websocket', serverUrl: 'https://private.example' } };
    const team = { id: 'team', name: 'Team', agentIds: ['agent'], remoteConnectionId: 'owner' };
    const first = companionTarget('laptop', team, agent);
    const changed = companionTarget('laptop', team, { ...agent, backendSession: { ...agent.backendSession!, kind: 'claude', sessionId: 'session', transport: 'stdio', serverUrl: 'https://other-private.example' } });
    expect(changed).toEqual(first);
    expect(first.locationId).toBe('owner'); expect(first.sessionId).not.toContain('private.example');
  });
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
