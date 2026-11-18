import { describe, expect, it } from 'vitest';
import { serviceTierCycle } from '../service-tier';

const tiers = (...ids: string[]) => ids.map(id => ({ id, name: id }));
describe('the speed button', () => {
  it('steps from standard through every faster tier in catalog order, then back to standard, like the desktop', () => {
    const offered = tiers('default', 'fast', 'ultrafast');
    expect(serviceTierCycle(offered, null)).toStrictEqual({ tiers: ['fast', 'ultrafast'], active: null, next: 'fast' });
    expect(serviceTierCycle(offered, 'fast').next).toBe('ultrafast');
    expect(serviceTierCycle(offered, 'ultrafast')).toMatchObject({ active: 'ultrafast', next: null });
  });
  it('treats the standard tier names as off and a tier the model no longer lists as a restart', () => {
    expect(serviceTierCycle(tiers('normal', 'priority'), 'normal')).toStrictEqual({ tiers: ['priority'], active: null, next: 'priority' });
    expect(serviceTierCycle(tiers('fast'), 'ultrafast')).toMatchObject({ active: 'ultrafast', next: null });
  });
  it('offers nothing when the model has no faster tier', () => {
    expect(serviceTierCycle(tiers('default'), null)).toStrictEqual({ tiers: [], active: null, next: null });
    expect(serviceTierCycle([], null).tiers).toStrictEqual([]);
  });
});
