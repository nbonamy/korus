import { describe, expect, it } from 'vitest';
import { CompanionRelayPolicy } from '../relay';
const host = '12D3KooW'.padEnd(52, 'h'); const phone = '12D3KooW'.padEnd(52, 'p');
const other = '12D3KooW'.padEnd(52, 'o');
const invite = (expiresAt = 1001, code = 'K7QDM2XP') => ({ code, expiresAt });
describe('trusted companion rendezvous', () => {
  it('allows only the first authenticated phone to claim and route a code; retries keep that identity', () => {
    const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
    policy.register(host, [], [invite()]);
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.resolve(phone, invite().code)).toBe(host);
    expect(policy.resolve(phone, invite().code)).toBe(host);
    expect(policy.resolve(other, invite().code)).toBeNull();
    expect(policy.route(phone, host)).toBe(true);
    expect(policy.route(other, host)).toBe(false);
    expect(policy.route(host, phone)).toBe(false);
  });
  it('never extends an invitation through heartbeats or a newer invitation', () => {
    let now = 1; const policy = new CompanionRelayPolicy(new Set([host]), () => now);
    policy.register(host, [], [invite()]);
    policy.resolve(phone, invite().code);
    now = 500;
    policy.register(host, [], [invite(2000), invite(3000, 'ABCDEFGH')]);
    now = 1001;
    expect(policy.resolve(phone, invite().code)).toBeNull();
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.resolve(other, 'ABCDEFGH')).toBe(host);
  });
  it('does not rearm a claimed or withdrawn code when its host advertises again', () => {
    const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
    policy.register(host, [], [invite()]);
    policy.resolve(phone, invite().code);
    policy.register(host, [], [invite()]);
    expect(policy.resolve(other, invite().code)).toBeNull();
    policy.register(host, []);
    expect(policy.route(phone, host)).toBe(false);
    policy.register(host, [], [invite()]);
    expect(policy.resolve(phone, invite().code)).toBeNull();
    expect(policy.resolve(other, invite().code)).toBeNull();
  });
  it('rejects a code collision instead of introducing a different laptop', () => {
    const policy = new CompanionRelayPolicy(new Set([host, other]), () => 1);
    policy.register(host, [], [invite()]);
    expect(() => policy.register(other, [], [invite()])).toThrow();
    expect(policy.resolve(phone, invite().code)).toBe(host);
  });
  it('expires temporary routes exactly at their deadline and preserves/revokes durable routes separately', () => {
    let now = 1; const policy = new CompanionRelayPolicy(undefined, () => now);
    expect(policy.route(phone, host)).toBe(false);
    policy.register(host, [], [invite()]); policy.resolve(phone, invite().code);
    now = 1001;
    expect(policy.route(phone, host)).toBe(false);
    policy.register(host, [phone]);
    expect(policy.paired(host, phone)).toBe(true);
    expect(policy.route(phone, host)).toBe(true);
    policy.register(host, []);
    expect(policy.route(phone, host)).toBe(false);
    policy.register(host, [phone]); now += 120_000;
    expect(policy.paired(host, phone)).toBe(false);
  });
  it('does not revive invitations when a host lease expires and returns', () => {
    let now = 1; const policy = new CompanionRelayPolicy(undefined, () => now);
    policy.register(host, [], [invite(300001)]); policy.resolve(phone, invite().code);
    now = 120001;
    expect(policy.resolve(phone, invite().code)).toBeNull();
    policy.register(host, [], [invite(300001)]);
    expect(policy.resolve(other, invite().code)).toBeNull();
  });
  it('bounds guesses per authenticated peer without revealing or consuming other codes', () => {
    let now = 1; const policy = new CompanionRelayPolicy(new Set([host]), () => now);
    policy.register(host, [], [invite()]);
    for (let n = 0; n < 10; n++) expect(policy.resolve(phone, 'AAAAAAAA')).toBeNull();
    expect(policy.resolve(phone, invite().code)).toBeNull();
    expect(policy.resolve(other, invite().code)).toBe(host);
    now += 300000;
    policy.register(host, [], [invite(now + 1000, 'ABCDEFGH')]);
    expect(policy.resolve(phone, 'ABCDEFGH')).toBe(host);
  });
  it('lets an honest phone pair while throwaway identities flood lookups', () => {
    const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
    policy.register(host, [], [invite()]);
    for (let n = 0; n < 500; n++) expect(policy.resolve(`flood${n}`, 'AAAAAAAA')).toBeNull();
    expect(policy.resolve(phone, invite().code)).toBe(host);
  });
  it('bounds host capacity and rejects unadmitted hosts, malformed codes and excessive TTLs', () => {
    let now = 1; const automatic = new CompanionRelayPolicy(undefined, () => now);
    for (let i = 0; i < 1000; i++) expect(automatic.reserve(`host${i}`)).toBe(true);
    expect(automatic.reserve('overflow')).toBe(false);
    now += 120000; expect(automatic.reserve('fresh')).toBe(true);
    const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
    expect(policy.reserve(other)).toBe(false);
    expect(() => policy.register(other, [])).toThrow();
    expect(() => policy.register(host, [], [invite(300002)])).toThrow();
    expect(() => policy.register(host, [], [invite(1000, 'K7QD')])).toThrow();
    expect(() => policy.register(host, [], [invite(1000, 'K7QDM2X0')])).toThrow();
    expect(() => policy.register(host, [], Array.from({ length: 6 }, () => invite()))).toThrow();
    expect(() => new CompanionRelayPolicy(new Set())).toThrow();
  });
});
