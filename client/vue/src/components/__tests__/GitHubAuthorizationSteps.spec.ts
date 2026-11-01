import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import WorkAuthorizationSteps from '../WorkAuthorizationSteps.vue';

describe('WorkAuthorizationSteps', () => {
  it('copies the device code and opens GitHub through its host', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(WorkAuthorizationSteps, {
      props: {
        authorization: {
          provider: 'github',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresAt: '2026-06-09T12:05:00.000Z',
        },
      },
    });

    await wrapper.get('[aria-label="Copy GitHub device code ABCD-1234"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith('ABCD-1234');
    expect(wrapper.findAllComponents({ name: 'ElButton' }).find((button) => button.text() === 'Open GitHub')?.props('type')).toBe('primary');

    await wrapper.findAll('button').find((button) => button.text() === 'Open GitHub')?.trigger('click');
    expect(wrapper.emitted('open')).toStrictEqual([[]]);

    await vi.advanceTimersByTimeAsync(1_400);
    expect(wrapper.get('[aria-label="Copy GitHub device code ABCD-1234"]').text()).toContain('ABCD-1234');
    vi.useRealTimers();
  });
});
