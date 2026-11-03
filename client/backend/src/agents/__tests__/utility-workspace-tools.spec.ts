import { describe, expect, it } from 'vitest';
import { hasGitSafeguards, readOnlyGitCommand } from '../utility-workspace-tools';

describe('utility workspace tools', () => {
  it('accepts only the exact fsmonitor override and requires both safeguards for native commands', () => {
    const safe = 'git --no-pager --no-optional-locks -c core.fsmonitor=false';
    expect(readOnlyGitCommand(`${safe} status --short`)).toContain('status');
    expect(readOnlyGitCommand('git -c core.fsmonitor=true status')).toBeNull();
    expect(readOnlyGitCommand('git -c core.pager=sh status')).toBeNull();
    expect(hasGitSafeguards(`${safe} status`)).toBe(true);
    expect(hasGitSafeguards('git --no-optional-locks status')).toBe(false);
    expect(hasGitSafeguards('git -c core.fsmonitor=false status')).toBe(false);
    expect(hasGitSafeguards('git status')).toBe(false);
  });
});
