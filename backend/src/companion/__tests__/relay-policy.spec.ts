import { describe, expect, it } from 'vitest';
import { CompanionRelayPolicy } from '../relay';
const host = '12D3KooW'.padEnd(52, 'h'); const phone = '12D3KooW'.padEnd(52, 'p');
describe('opaque companion relay admission', () => {
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
});
