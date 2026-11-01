import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfettiOverlay from '../ConfettiOverlay.vue';
import { clearConfetti, useConfetti } from '../use-confetti';

const canvasCelebrationMocks = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock('../canvas-celebration', () => ({
  launchCanvasCelebration: canvasCelebrationMocks.launch,
}));

describe('ConfettiOverlay', () => {
  afterEach(() => {
    clearConfetti();
    canvasCelebrationMocks.launch.mockClear();
    vi.useRealTimers();
  });

  it('renders reusable celebration bursts and clears them after animation', async () => {
    vi.useFakeTimers();
    const { celebrate } = useConfetti();
    const wrapper = mount(ConfettiOverlay, {
      attachTo: document.body,
    });

    celebrate({ count: 6, durationMs: 600 });
    await wrapper.vm.$nextTick();

    expect(document.body.querySelectorAll('.confetti-overlay__piece')).toHaveLength(6);

    await vi.advanceTimersByTimeAsync(1_000);
    await wrapper.vm.$nextTick();

    expect(document.body.querySelector('.confetti-overlay')).toBeNull();
    wrapper.unmount();
  });

  it('keeps the top-falling confetti and delegates every canvas layer once', async () => {
    vi.useFakeTimers();
    const { celebrate } = useConfetti();
    const wrapper = mount(ConfettiOverlay, { attachTo: document.body });

    celebrate({ kind: 'confetti', count: 3 });
    celebrate({ kind: 'stars', count: 4 });
    celebrate({ kind: 'shapes', count: 5 });
    celebrate({ kind: 'schoolPride', count: 6 });
    await wrapper.vm.$nextTick();

    expect(document.body.querySelectorAll('.confetti-overlay__burst .confetti-overlay__piece')).toHaveLength(3);
    expect(document.body.querySelectorAll('.confetti-overlay__burst')).toHaveLength(1);
    expect(canvasCelebrationMocks.launch).toHaveBeenCalledWith('confetti', expect.any(Number));
    expect(canvasCelebrationMocks.launch).toHaveBeenCalledWith('stars', expect.any(Number));
    expect(canvasCelebrationMocks.launch).toHaveBeenCalledWith('shapes', expect.any(Number));
    expect(canvasCelebrationMocks.launch).toHaveBeenCalledWith('schoolPride', expect.any(Number));

    wrapper.unmount();
  });
});
