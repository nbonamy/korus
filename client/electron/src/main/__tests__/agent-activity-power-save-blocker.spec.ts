import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ powerSaveBlocker: { start: vi.fn(), stop: vi.fn() } }));
import { AgentActivityPowerSaveBlocker } from '../agent-activity-power-save-blocker';

function setup() {
  const start = vi.fn().mockReturnValueOnce(42).mockReturnValueOnce(43).mockReturnValueOnce(44).mockReturnValue(45);
  const stop = vi.fn();
  return { start, stop, blocker: new AgentActivityPowerSaveBlocker({ start, stop }) };
}

describe('AgentActivityPowerSaveBlocker', () => {
  it('keeps the system available without holding the display for ordinary agent activity', () => {
    const { start, stop, blocker } = setup();
    blocker.sync('suspension');
    blocker.sync('suspension');
    expect(start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension');
    expect(stop).not.toHaveBeenCalled();
  });

  it('holds the display awake, so the session cannot idle-lock, for as long as it is asked to', () => {
    const { start, stop, blocker } = setup();
    blocker.sync('display');
    blocker.sync('display');
    expect(start).toHaveBeenCalledExactlyOnceWith('prevent-display-sleep');
    expect(stop).not.toHaveBeenCalled();
  });

  it('holds a single blocker and swaps it as the needed protection changes', () => {
    const { start, stop, blocker } = setup();
    blocker.sync('suspension');
    blocker.sync('display');
    blocker.sync('suspension');
    blocker.sync('none');
    expect(start.mock.calls.map(([type]) => type)).toStrictEqual(['prevent-app-suspension', 'prevent-display-sleep', 'prevent-app-suspension']);
    expect(stop.mock.calls.map(([id]) => id)).toStrictEqual([42, 43, 44]);
  });

  it('releases on stop and starts again afterwards', () => {
    const { start, stop, blocker } = setup();
    blocker.sync('display');
    blocker.stop();
    blocker.stop();
    blocker.sync('display');
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledExactlyOnceWith(42);
  });
});
