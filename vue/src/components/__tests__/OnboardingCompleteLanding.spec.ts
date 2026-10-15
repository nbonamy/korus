import { mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { clearConfetti, useConfetti } from '../../shared/confetti/use-confetti';
import OnboardingCompleteLanding from '../OnboardingCompleteLanding.vue';

afterEach(() => { clearConfetti(); vi.useRealTimers(); });

it('keeps the final onboarding page open until the user continues', async () => {
  vi.useFakeTimers();
  const wrapper = mount(OnboardingCompleteLanding);
  try {
    expect(useConfetti().bursts.value).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(wrapper.emitted('complete')).toBeUndefined();
    await wrapper.get('.onboarding-complete__action').trigger('click');
    expect(wrapper.emitted('complete')).toStrictEqual([[]]);
  } finally {
    wrapper.unmount();
  }
});

it('can continue without a celebration or a reporting preference request', async () => {
  const wrapper = mount(OnboardingCompleteLanding, { props: { celebrate: false } });
  try {
    expect(useConfetti().bursts.value).toHaveLength(0);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('complete')).toStrictEqual([[]]);
  } finally {
    wrapper.unmount();
  }
});
