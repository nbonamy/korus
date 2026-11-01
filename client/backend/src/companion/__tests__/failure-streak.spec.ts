import { describe, expect, it } from 'vitest';
import { FailureStreak } from '../failure-streak';

describe('failure streak', () => {
  it('trips after the limit of consecutive failures and starts over', () => {
    const streak = new FailureStreak(3);
    expect([streak.record(false), streak.record(false), streak.record(false)]).toStrictEqual([false, false, true]);
    expect([streak.record(false), streak.record(false), streak.record(false)]).toStrictEqual([false, false, true]);
  });

  it('forgets earlier failures after a success', () => {
    const streak = new FailureStreak(3);
    streak.record(false); streak.record(false); streak.record(true);
    expect([streak.record(false), streak.record(false)]).toStrictEqual([false, false]);
  });
});
