import { describe, expect, it } from 'vitest';
import { isThreadFlags } from '../thread-flags';

describe('thread flags', () => {
  it('accepts only enabled predefined thread flags', () => {
    expect(isThreadFlags({ work_proposed: true })).toBe(true);
    expect(isThreadFlags({ ready_for_review: true, work_proposed: true })).toBe(true);
    expect(isThreadFlags({ work_proposed: false })).toBe(false);
    expect(isThreadFlags({ unknown: true })).toBe(false);
    expect(isThreadFlags({ delegate_to_worktree: true })).toBe(false);
  });
});
