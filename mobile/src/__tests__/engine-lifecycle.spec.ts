import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../engine-lifecycle';

afterEach(() => vi.useRealTimers());
const grace = 300_000;
function fixture(suspend = vi.fn(async () => {})) {
  let background = true;
  const lifecycle = createLifecycle({ graceMs: grace, suspend });
  return { lifecycle, suspend, left: () => lifecycle.left(() => background), returnToApp: () => { background = false; return lifecycle.returned(); }, goBackground: () => { background = true; } };
}

describe('background grace period', () => {
  it('suspends the connection once when the app stays away past the grace period', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.left(); f.left();
    await vi.advanceTimersByTimeAsync(grace - 1); expect(f.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.suspend).toHaveBeenCalledOnce();
  });

  it('does not suspend a short absence, and a later absence gets a full grace period of its own', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.left(); await vi.advanceTimersByTimeAsync(10_000);
    await f.returnToApp(); f.goBackground(); f.left();
    await vi.advanceTimersByTimeAsync(grace - 1); expect(f.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(f.suspend).toHaveBeenCalledOnce();
  });

  it('suspends before the app is usable again when it returns after the grace period', async () => {
    vi.useFakeTimers(); let release!: () => void;
    const f = fixture(vi.fn(() => new Promise<void>((resolve) => { release = resolve; })));
    f.left(); vi.setSystemTime(Date.now() + grace + 1_000);
    let usable = false; const returned = f.returnToApp().then(() => { usable = true; });
    await vi.advanceTimersByTimeAsync(0); expect(f.suspend).toHaveBeenCalledOnce(); expect(usable).toBe(false);
    release(); await returned; expect(usable).toBe(true);
  });
});
