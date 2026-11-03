import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerUseActivity } from '../computer-use-activity';

afterEach(() => vi.useRealTimers());

describe('ComputerUseActivity', () => {
  it('stays active for the hold period after each use and tells listeners only when that changes', () => {
    vi.useFakeTimers();
    const activity = new ComputerUseActivity(60_000);
    const listener = vi.fn();
    activity.onChange(listener);
    expect(activity.isActive()).toBe(false);
    activity.touch();
    activity.touch();
    expect(activity.isActive()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_000);
    activity.touch();
    vi.advanceTimersByTime(59_000);
    expect(activity.isActive()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(activity.isActive()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying a removed listener', () => {
    vi.useFakeTimers();
    const activity = new ComputerUseActivity(1_000);
    const listener = vi.fn();
    activity.onChange(listener)();
    activity.touch();
    expect(listener).not.toHaveBeenCalled();
  });
});
