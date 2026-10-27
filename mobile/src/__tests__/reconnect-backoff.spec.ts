import { describe, expect, it } from 'vitest';
import { createBackoff } from '../reconnect-backoff';

describe('reconnect backoff', () => {
  it('never keeps a waiting person more than a few seconds, however long the laptop has been away', () => {
    const backoff = createBackoff(() => 1);
    const delays = Array.from({ length: 12 }, () => backoff.next());
    expect(Math.max(...delays)).toBeCloseTo(6_000, 0);
    expect(delays[0]).toBeLessThan(1_300);
    expect(delays.slice(4).every((delay) => delay >= 4_000)).toBe(true);
  });

  it('starts over after a success', () => {
    const backoff = createBackoff(() => 0.5);
    for (let index = 0; index < 6; index++) backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(1_000);
  });
});
