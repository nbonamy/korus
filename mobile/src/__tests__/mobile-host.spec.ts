import { describe, expect, it, vi } from 'vitest';
import { createMobileHost } from '../mobile-host';

const native = vi.hoisted(() => ({ platform: 'web', addListener: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => native.platform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener } }));

describe('mobile host lifecycle', () => {
  it('does not invoke native plugins in the browser preview', async () => {
    native.platform = 'web';
    native.addListener.mockClear();
    const stop = await createMobileHost().onResume(vi.fn());
    stop();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it('forwards only native resume and removes its native listener', async () => {
    native.platform = 'ios';
    const remove = vi.fn().mockResolvedValue(undefined);
    let callback!: (state: { isActive: boolean }) => void;
    native.addListener.mockImplementation(async (_event, listener) => {
      callback = listener;
      return { remove };
    });
    const resumed = vi.fn();
    const stop = await createMobileHost().onResume(resumed);
    callback({ isActive: false });
    expect(resumed).not.toHaveBeenCalled();
    callback({ isActive: true });
    expect(resumed).toHaveBeenCalledTimes(1);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
