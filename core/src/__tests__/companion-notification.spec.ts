import { describe, expect, it } from 'vitest';
import { companionPushAuthorizationMessage, isCompanionNotification } from '../companion-notification';

describe('companion notification wire validation', () => {
  it('encodes phone consent with a stable domain and all delivery identities', () => {
    expect(new TextDecoder().decode(companionPushAuthorizationMessage('relay', 'host', 'phone', { token: 'abcd', environment: 'production' }, 123))).toBe(
      '["companion-push-consent-v1","relay","host","phone","abcd","production",123]');
  });
  it('accepts a bounded target and rejects malformed attention metadata', () => {
    const valid = { id: 'event', name: 'Builder', kind: 'completed', createdAt: 10,
      target: { hostId: 'host', locationId: 'local', teamId: 'team', agentId: 'agent', sessionId: null } };
    expect(isCompanionNotification(valid)).toBe(true);
    for (const value of [null, {}, { ...valid, id: 'a'.repeat(65) }, { ...valid, kind: 'arbitrary' },
      { ...valid, name: 'a'.repeat(101) }, { ...valid, createdAt: Infinity }, { ...valid, target: { ...valid.target, agentId: '' } },
      { ...valid, target: { ...valid.target, sessionId: {} } }]) expect(isCompanionNotification(value)).toBe(false);
  });
});
