import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchCanvasCelebration } from '../canvas-celebration';

const canvasConfettiMocks = vi.hoisted(() => ({
  fire: vi.fn((_options: Record<string, unknown>) => Promise.resolve()),
  shapeFromPath: vi.fn((options: { path: string }) => ({ path: options.path, type: 'path' as const })),
}));

vi.mock('canvas-confetti', () => ({
  default: Object.assign(canvasConfettiMocks.fire, {
    shapeFromPath: canvasConfettiMocks.shapeFromPath,
  }),
}));

describe('canvas celebration presets', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    canvasConfettiMocks.fire.mockClear();
    canvasConfettiMocks.shapeFromPath.mockClear();
  });

  it('layers the realistic burst under the existing top-falling confetti', () => {
    launchCanvasCelebration('confetti', 2_400);

    expect(canvasConfettiMocks.fire).toHaveBeenCalledTimes(5);
    expect(canvasConfettiMocks.fire.mock.calls.reduce((total, [options]) => (
      total + Number(options?.particleCount ?? 0)
    ), 0)).toBe(140);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledWith(expect.objectContaining({
      disableForReducedMotion: true,
      origin: { y: 0.7 },
      spread: 100,
    }));
  });

  it('launches the short staggered stars preset', async () => {
    vi.useFakeTimers();

    launchCanvasCelebration('stars', 2_400);
    await vi.runAllTimersAsync();

    expect(canvasConfettiMocks.fire).toHaveBeenCalledTimes(6);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledWith(expect.objectContaining({
      shapes: ['star'],
      spread: 360,
    }));
    expect(canvasConfettiMocks.fire).toHaveBeenCalledWith(expect.objectContaining({
      shapes: ['circle'],
      spread: 360,
    }));
  });

  it('builds and reuses the official custom path shapes', () => {
    launchCanvasCelebration('shapes', 2_400);
    launchCanvasCelebration('shapes', 2_400);

    expect(canvasConfettiMocks.shapeFromPath).toHaveBeenCalledTimes(3);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledTimes(6);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledWith(expect.objectContaining({
      origin: { y: -0.1 },
      particleCount: 30,
      scalar: 2,
    }));
  });

  it('caps school pride at a restrained continuous duration', async () => {
    vi.useFakeTimers();

    launchCanvasCelebration('schoolPride', 15_000);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_500);
    const callsAfterCap = canvasConfettiMocks.fire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(callsAfterCap).toBeGreaterThan(2);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledTimes(callsAfterCap);
    expect(canvasConfettiMocks.fire).toHaveBeenCalledWith(expect.objectContaining({
      angle: 60,
      origin: { x: 0 },
      particleCount: 3,
    }));
  });
});
