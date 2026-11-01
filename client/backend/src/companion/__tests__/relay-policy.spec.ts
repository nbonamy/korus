import { describe, expect, it } from 'vitest';
import { CompanionRelayPolicy } from '../relay';
import { ShareRelayDirectory } from '../../sharing/relay-directory';
const host = '12D3KooW'.padEnd(52, 'h'); const phone = '12D3KooW'.padEnd(52, 'p');
const other = '12D3KooW'.padEnd(52, 'o');
const invite = (expiresAt = 1001, code = 'K7QDM2XP') => ({ code, expiresAt });
describe('trusted companion rendezvous', () => {
  it('limits a configured code to its admitted destination and expires each temporary circuit permission', () => {
    let now = 1;
    const pairing = { code: 'ABCDEFGH', hostId: host };
    const policy = new CompanionRelayPolicy(undefined, () => now, pairing);
    expect(policy.resolve(phone, pairing.code)).toBeNull();
    policy.register(host, []); policy.register(other, []);
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.resolve(phone, pairing.code)).toBe(host);
    expect(policy.route(phone, host)).toBe(true);
    expect(policy.route(phone, other)).toBe(false);
    expect(() => policy.register(other, [], [invite(1000, pairing.code)])).toThrow();
    // Refresh the host lease without extending the phone's temporary lookup permission.
    now = 100_000; policy.register(host, []);
    now = 200_000; policy.register(host, []);
    now = 300_001; policy.register(host, []);
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.resolve(phone, pairing.code)).toBe(host);
    policy.register(host, [phone]);
    now += 100_000; policy.register(host, [phone]);
    now += 100_000; policy.register(host, [phone]);
    now += 100_000; policy.register(host, [phone]);
    expect(policy.route(phone, host)).toBe(true);
    policy.register(host, []);
    expect(policy.route(phone, host)).toBe(false);
  });

  it('keeps configured-route lookup state bounded and clears it when its host lease ends', () => {
    let now = 1;
    const pairing = { code: 'ABCDEFGH', hostId: host };
    const policy = new CompanionRelayPolicy(undefined, () => now, pairing);
    policy.register(host, []);
    for (let index = 0; index < 1000; index++) policy.resolve(`phone-${index}`, pairing.code);
    expect(policy.route('phone-0', host)).toBe(false);
    expect(policy.route('phone-999', host)).toBe(true);
    expect(policy.resolve(phone, pairing.code)).toBe(host);
    expect(policy.route(phone, host)).toBe(true);
    now += 120_000;
    policy.register(host, []);
    expect(policy.route(phone, host)).toBe(false);
    expect(policy.resolve(phone, pairing.code)).toBe(host);
  });

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
  it('keeps unrelated laptops and pairing available when two sources rotate identities to exhaust leases', () => {
    const policy = new CompanionRelayPolicy(undefined, () => 1);
    for (const source of ['192.0.2.1', '192.0.2.2']) {
      for (let i = 0; i < 20; i++) expect(policy.reserve(`${source}-${i}`, source)).toBe(true);
      for (let i = 20; i < 1200; i++) expect(policy.reserve(`${source}-${i}`, source)).toBe(false);
    }
    expect(policy.reserve(host, '192.0.2.3')).toBe(true);
    policy.register(host, [], [invite()], '192.0.2.3');
    expect(policy.resolve(phone, invite().code)).toBe(host);
    expect(policy.reserve(host, '192.0.2.3')).toBe(true);
    policy.register(host, [phone], [], '192.0.2.3');
    expect(policy.paired(host, phone)).toBe(true);
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

// Isolated policy failure modes: owner spoofing, destructive capacity rejection,
// one-shot claims, expired permits, withdrawn handles, and identity-rotation abuse.
describe('reusable guest routing directory', () => {
  const handle = (n: number) => String(n).padStart(32, 'a');
  it('routes several guest identities without claiming a handle and removes only withdrawn permits', () => {
    let now = 1;
    const directory = new ShareRelayDirectory(() => now);
    expect(directory.resolve(phone, 'source', host, handle(1))).toBe('unavailable');
    expect(directory.register(host, 'owner-source', [handle(1), handle(2)])).toBe('ready');
    expect(directory.register(other, 'other-source', [handle(1)])).toBe('unavailable');
    expect(directory.discover(phone, 'source', handle(1))).toStrictEqual({ status: 'ready', ownerId: host });
    expect(directory.resolve(phone, 'source', host, handle(1))).toBe('ready');
    expect(directory.resolve(other, 'source', host, handle(1))).toBe('ready');
    expect(directory.route(phone, host)).toBe(true);
    expect(directory.route(other, host)).toBe(true);
    expect(directory.route(phone, other)).toBe(false);
    expect(directory.register(host, 'owner-source', [handle(2)])).toBe('ready');
    expect(directory.route(phone, host)).toBe(false);
    expect(directory.resolve(phone, 'source', host, handle(1))).toBe('unavailable');
    expect(directory.discover(phone, 'source', handle(1))).toStrictEqual({ status: 'unavailable' });
    expect(directory.register(other, 'other-source', [handle(1)])).toBe('ready');
    expect(directory.resolve(phone, 'source', other, handle(1))).toBe('ready');
    now += 120_000;
    expect(directory.route(phone, other)).toBe(false);
    expect(directory.resolve(phone, 'source', other, handle(1))).toBe('unavailable');
    expect(directory.register(other, 'other-source', [handle(1)])).toBe('ready');
    expect(directory.discover(phone, 'source', handle(1))).toStrictEqual({ status: 'ready', ownerId: other });
    expect(directory.resolve(phone, 'source', other, handle(1))).toBe('ready');
    expect(new ShareRelayDirectory(() => now).resolve(phone, 'source', other, handle(1))).toBe('unavailable');
  });
  it('admits more than fifty owner handles and rejects capacity atomically without evicting existing routes', () => {
    let now = 1; const directory = new ShareRelayDirectory(() => now);
    expect(directory.register(host, 'source', Array.from({ length: 5000 }, (_, i) => handle(i)))).toBe('ready');
    expect(directory.register(other, 'other', [handle(5000)])).toBe('capacity');
    now = 100_001;
    expect(directory.register(host, 'source', Array.from({ length: 5001 }, (_, i) => handle(i)))).toBe('capacity');
    now = 150_001;
    expect(directory.resolve(phone, 'phone', host, handle(0))).toBe('ready');
    expect(directory.resolve(phone, 'phone', host, handle(4999))).toBe('ready');
    expect(directory.register(host, 'source', [handle(0)])).toBe('ready');
    expect(directory.register(other, 'other', [handle(5000)])).toBe('ready');
  });
  it('bounds source-network lookups and temporary permissions independently from link storage', () => {
    let now = 1;
    const directory = new ShareRelayDirectory(() => now);
    directory.register(host, 'owner', [handle(1)]);
    for (let i = 0; i < 120; i++) expect(directory.resolve(`guest-${i}`, 'shared-network', host, handle(1))).toBe('ready');
    expect(directory.resolve('rotated-identity', 'shared-network', host, handle(1))).toBe('rateLimited');
    for (let i = 120; i < 200; i++) expect(directory.resolve(`guest-${i}`, 'another-network', host, handle(1))).toBe('ready');
    expect(directory.resolve('overflow', 'third-network', host, handle(1))).toBe('capacity');
    now += 60_000;
    expect(directory.register(host, 'owner', [handle(1)])).toBe('ready');
    now += 60_001;
    expect(directory.route('guest-0', host)).toBe(false);
    expect(directory.resolve('overflow', 'third-network', host, handle(1))).toBe('ready');
    // Moving an existing peer's permission onto a saturated source must not
    // bypass the source budget merely because its owner/guest key already exists.
    directory.register('roaming-owner', 'roaming-owner-network', [handle(2)]);
    expect(directory.resolve('roaming-guest', 'home-network', 'roaming-owner', handle(2))).toBe('ready');
    for (let i = 0; i < 200; i++) {
      directory.register(`crowd-owner-${i}`, `owner-network-${i}`, [handle(i + 3)]);
      if (i === 120) now += 60_000;
      expect(directory.resolve(`crowd-guest-${i}`, 'crowded-network', `crowd-owner-${i}`, handle(i + 3))).toBe('ready');
    }
    expect(directory.resolve('roaming-guest', 'crowded-network', 'roaming-owner', handle(2))).toBe('capacity');
    for (let i = 0; i < 60; i++) directory.register(`owner-${i}`, 'flood', []);
    expect(directory.register('new-identity', 'flood', [])).toBe('rateLimited');
  });
});
