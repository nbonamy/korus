import { describe, expect, it } from 'vitest';
import { WindowBudget, sourceNetwork } from '../source-budget';

describe('relay source identity', () => {
  it.each([
    ['an IPv4 address', '192.0.2.1', '192.0.2.1'],
    ['an IPv4-mapped IPv6 address', '::ffff:192.0.2.1', '192.0.2.1'],
    ['a hex IPv4-mapped IPv6 address', '::ffff:c000:201', '192.0.2.1'],
    ['a compressed IPv6 address', '2001:db8:1:2::9', '2001:db8:1:2::/64'],
    ['the same /64 written in full', '2001:0DB8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['a prefix compressed into the network part', '2001:db8::1', '2001:db8:0:0::/64'],
    ['an embedded IPv4 suffix', '64:ff9b:1:2::192.0.2.1', '64:ff9b:1:2::/64'],
    ['a host name', 'relay.example', undefined],
    ['an address list', '192.0.2.1, 192.0.2.2', undefined],
  ])('maps %s to its network', (_name, address, network) => {
    expect(sourceNetwork(address)).toBe(network);
  });
});

describe('fixed-window budgets', () => {
  it('refills a key when its window ends', () => {
    let now = 0;
    const budget = new WindowBudget(2, 1000, 10, () => now);
    expect([budget.take('a'), budget.take('a'), budget.take('a')]).toStrictEqual([true, true, false]);
    now = 1000;
    expect(budget.take('a')).toBe(true);
  });
  it('evicts the oldest window instead of refusing a new key when full', () => {
    const budget = new WindowBudget(1, 1000, 2, () => 0);
    budget.take('first'); budget.take('second');
    expect(budget.take('third')).toBe(true);
    expect(budget.take('first')).toBe(true);
    expect(budget.take('third')).toBe(false);
  });
  it('does not lock a key out after the wall clock steps back', () => {
    let now = 10_000;
    const budget = new WindowBudget(1, 1000, 10, () => now);
    budget.take('a');
    now = 0;
    expect(budget.take('a')).toBe(true);
  });
  it('refills a key whose window expired behind a newer one after the clock stepped back', () => {
    let now = 10_000;
    const budget = new WindowBudget(1, 1000, 10, () => now);
    budget.take('ahead');
    now = 0; budget.take('behind');
    now = 1000;
    expect(budget.take('behind')).toBe(true);
  });
});
