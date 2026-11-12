import { describe, expect, it } from 'vitest';
import { CompanionFrameDecoder, companionFrameLimit, companionResponseLimit, companionSessionId, companionTarget, companionTargetFor, encodeCompanionFrame, legacyPermissionCall, sameCompanionSession, sameCompanionTarget, withLegacyConversationId, withLegacyPermission } from '../companion-protocol';
import type { Agent } from '../contracts';

describe('companion wire framing', () => {
  it('keeps a session target stable when private provider connection metadata changes', () => {
    const agent: Agent = { id: 'agent', teamId: 'team', name: 'Agent', provider: 'claude', folder: null,
      status: { type: 'idle' }, createdAt: '', updatedAt: '', providerSession: { kind: 'claude', conversationId: 'session', transport: 'websocket', serverUrl: 'https://private.example' }, remoteConnectionId: 'owner' };
    const team = { id: 'team', name: 'Team', agentIds: ['agent'] };
    const first = companionTarget('laptop', team, agent);
    const changed = companionTarget('laptop', team, { ...agent, providerSession: { ...agent.providerSession!, kind: 'claude', conversationId: 'session', transport: 'stdio', serverUrl: 'https://other-private.example' } });
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
  it('accepts a larger paired-laptop response without raising the inbound request limit', () => {
    const response = { result: { text: 'x'.repeat(companionFrameLimit) } };
    const encoded = encodeCompanionFrame(response, companionResponseLimit);
    expect(() => new CompanionFrameDecoder().push(encoded.subarray(0, 4))).toThrow('length');
    const decoder = new CompanionFrameDecoder(companionResponseLimit);
    expect(decoder.push(encoded.subarray(0, 100))).toEqual([]);
    expect(decoder.push(encoded.subarray(100))).toEqual([response]);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, companionResponseLimit + 1);
    expect(() => new CompanionFrameDecoder(companionResponseLimit).push(header)).toThrow('length');
  });
  it('rejects oversized frames before accepting payload bytes and rejects malformed JSON', () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, companionFrameLimit + 1);
    expect(() => new CompanionFrameDecoder().push(header)).toThrow('length');
    expect(() => encodeCompanionFrame('x'.repeat(companionFrameLimit))).toThrow('large');
    expect(() => new CompanionFrameDecoder().push(new Uint8Array([0, 0, 0, 1, 33]))).toThrow();
  });
});

describe('conversation names on the companion wire', () => {
  it('keeps the names shipped phones read', () => {
    const codex = { kind: 'codex' as const, conversationId: 't1' };
    const claude = { kind: 'claude' as const, conversationId: 's1', transport: 'stdio' as const };
    expect(companionSessionId({ providerSession: codex } as Agent, true)).toBe('{"kind":"codex","threadId":"t1"}');
    expect(companionSessionId({ providerSession: claude } as Agent, true)).toBe('{"kind":"claude","sessionId":"s1"}');
    expect(withLegacyConversationId(codex)).toEqual({ ...codex, threadId: 't1' });
    expect(withLegacyConversationId(claude)).toEqual({ ...claude, sessionId: 's1' });
    expect(withLegacyPermission({ kind: 'codex', permission: 'approve-for-me' })).toEqual({ kind: 'codex', permission: 'approve-for-me', approvalPreset: 'approve-for-me' });
    expect(withLegacyPermission({ kind: 'cursor', permission: 'full-access' })).toEqual({ kind: 'cursor', permission: 'full-access', permissionMode: 'full-access' });
    expect(withLegacyPermission({ kind: 'claude' })).toEqual({ kind: 'claude' });
  });
});

describe('the current companion data model', () => {
  const agent = { id: 'a', teamId: 't', provider: 'codex', providerSession: { kind: 'codex', conversationId: 't1' } } as Agent;
  const team = { id: 't', name: 'T', agentIds: ['a'] };
  it('names the conversation conversationId, and the former names for a laptop that predates it', () => {
    expect(companionSessionId(agent)).toBe('{"kind":"codex","conversationId":"t1"}');
    expect(companionTargetFor({ dataModel: 2 }, 'host', team, agent).sessionId).toBe('{"kind":"codex","conversationId":"t1"}');
    expect(companionTargetFor({}, 'host', team, agent).sessionId).toBe('{"kind":"codex","threadId":"t1"}');
  });
  it('matches keys and targets whichever names they were written with', () => {
    expect(sameCompanionSession('{"kind":"codex","conversationId":"t1"}', '{"kind":"codex","threadId":"t1"}')).toBe(true);
    expect(sameCompanionSession('{"kind":"claude","sessionId":"s1"}', '{"kind":"claude","conversationId":"s1"}')).toBe(true);
    expect(sameCompanionSession('{"kind":"codex","conversationId":"t1"}', '{"kind":"codex","conversationId":"t2"}')).toBe(false);
    expect(sameCompanionSession('{"kind":"codex","conversationId":"t1"}', '{"kind":"cursor","conversationId":"t1"}')).toBe(false);
    expect(sameCompanionSession(null, null)).toBe(true);
    expect(sameCompanionSession('not json', 'not json either')).toBe(false);
    expect(sameCompanionTarget(companionTarget('host', team, agent), companionTarget('host', team, agent, true))).toBe(true);
    expect(sameCompanionTarget(companionTarget('host', team, agent), { ...companionTarget('host', team, agent), agentId: 'b' })).toBe(false);
  });
  it('sends a laptop that predates it the permission call it takes', () => {
    expect(legacyPermissionCall('codex', 'full-access')).toStrictEqual({ method: 'agent.approvalPreset.set', input: { preset: 'full-access' } });
    expect(legacyPermissionCall('cursor', 'default')).toStrictEqual({ method: 'agent.permissionMode.set', input: { mode: 'default' } });
  });
});
