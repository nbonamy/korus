import { describe, expect, it } from 'vitest';
import { CompanionRelayPolicy } from '../relay';
const host = '12D3KooW'.padEnd(52, 'h'); const phone = '12D3KooW'.padEnd(52, 'p');
describe('opaque companion relay admission', () => {
  it('admits new laptops automatically while requiring their live pairing or device grant for routing', () => {
    let now = 1; const policy = new CompanionRelayPolicy(undefined, () => now);
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.reserve(host)).toBe(true);
    policy.register(host, [], now + 1000, ['K7QD']);
    expect(policy.resolve(phone, 'K7QD')).toBe(host);
    expect(policy.route(phone, host)).toBe(true);
    now += 1001;
    expect(policy.route(phone, host)).toBe(false);
    policy.register(host, [phone], 0);
    expect(policy.paired(host, phone)).toBe(true);
    now += 120_001;
    expect(policy.paired(host, phone)).toBe(false);
    expect(policy.route(phone, host)).toBe(false);
  });
  it('bounds automatic host registrations and recovers capacity when advertisements expire', () => {
    let now = 1; const policy = new CompanionRelayPolicy(undefined, () => now);
    for (let i = 0; i < 1000; i++) expect(policy.reserve(`host${i}`)).toBe(true);
    expect(policy.reserve('overflow')).toBe(false);
    now += 120_001;
    expect(policy.reserve('fresh')).toBe(true);
  });
  it('admits only operator-configured laptops, bounds pairing attempts, and expires temporary routes', () => {
    let now = 1; const policy = new CompanionRelayPolicy(new Set([host]), () => now);
    expect(policy.reserve('unknown')).toBe(false); expect(policy.reserve(host)).toBe(true);
    expect(policy.route(phone, host)).toBe(false);
    expect(() => policy.register('unknown', [phone], now + 1000)).toThrow();
    expect(() => policy.register(host, [], now + 300_001)).toThrow();
    policy.register(host, [], now + 1000);
    expect([policy.route(phone, host), policy.route(phone, host), policy.route(phone, host), policy.route(phone, host)]).toEqual([true, true, true, false]);
    expect(policy.route(host, phone)).toBe(false);
    now += 1001; expect(policy.route(phone, host)).toBe(false);
  });
  it('allows paired routes across connection renewal and removes revoked routes independently of pairing windows', () => {
    const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
    policy.register(host, [phone], 0); expect(policy.route(phone, host)).toBe(true);
    policy.register(host, [], 0); expect(policy.route(phone, host)).toBe(false);
    expect(() => new CompanionRelayPolicy(new Set())).toThrow();
  });
  describe('pairing rendezvous', () => {
    const other = '12D3KooW'.padEnd(52, 'o');
    it('resolves a live pairing channel to its laptop and stops once the window closes', () => {
      let now = 1; const policy = new CompanionRelayPolicy(new Set([host]), () => now);
      expect(policy.resolve(phone, 'K7QD')).toBeNull();
      policy.register(host, [], now + 1000, ['K7QD', 'M2XP']);
      expect(policy.resolve(phone, 'K7QD')).toBe(host); expect(policy.resolve(phone, 'M2XP')).toBe(host); expect(policy.resolve(phone, 'ZZZZ')).toBeNull();
      now += 1001; expect(policy.resolve(phone, 'K7QD')).toBeNull();
    });
    it('replaces a laptop\'s own channels on each advertisement and drops the ones it no longer lists', () => {
      const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
      policy.register(host, [], 1000, ['K7QD']); policy.register(host, [], 1000, ['M2XP']);
      expect(policy.resolve(phone, 'K7QD')).toBeNull(); expect(policy.resolve(phone, 'M2XP')).toBe(host);
    });
    it('keeps the first laptop to claim a live channel so another laptop cannot take it over', () => {
      const policy = new CompanionRelayPolicy(new Set([host, other]), () => 1);
      policy.register(host, [], 1000, ['K7QD']); policy.register(other, [], 1000, ['K7QD']);
      expect(policy.resolve(phone, 'K7QD')).toBe(host);
    });
    it('bounds how many channels one source can try and rejects malformed channels', () => {
      const policy = new CompanionRelayPolicy(new Set([host]), () => 1);
      policy.register(host, [], 1000, ['K7QD']);
      const results = Array.from({ length: 12 }, () => policy.resolve(phone, 'K7QD'));
      expect(results.filter(Boolean)).toHaveLength(10);
      expect(policy.resolve(other, 'K7QD')).toBe(host);
      expect(() => policy.register(host, [], 1000, ['k7qd'])).toThrow();
      expect(() => policy.register(host, [], 1000, ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF'])).toThrow();
    });
  });
});
