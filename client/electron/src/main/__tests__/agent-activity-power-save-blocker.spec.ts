import { describe, expect, it, vi } from 'vitest';
import { AgentActivityPowerSaveBlocker } from '../agent-activity-power-save-blocker';

describe('AgentActivityPowerSaveBlocker', () => {
  it('starts a display sleep blocker when backend client state requests it', () => {
    const start = vi.fn().mockReturnValue(42);
    const stop = vi.fn();
    const blocker = new AgentActivityPowerSaveBlocker({ start, stop });

    blocker.sync(true);
    blocker.sync(true);

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops the blocker when backend client state no longer requests it', () => {
    const start = vi.fn().mockReturnValue(42);
    const stop = vi.fn();
    const blocker = new AgentActivityPowerSaveBlocker({ start, stop });

    blocker.sync(true);

    blocker.sync(false);

    blocker.sync(true);
    blocker.sync(false);

    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenNthCalledWith(1, 42);
    expect(stop).toHaveBeenNthCalledWith(2, 42);
  });
});
