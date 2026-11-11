import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ProviderIcon from '../ProviderIcon.vue';

describe('ProviderIcon', () => {
  it.each(['codex', 'antigravity', 'cursor'] as const)('renders the %s mark in the surrounding text color so it follows the theme', (provider) => {
    const wrapper = mount(ProviderIcon, { props: { provider: provider }, attachTo: document.body });
    const icon = wrapper.get('.provider-icon');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(getComputedStyle(icon.element).maskImage).toContain('url(');
    for (const color of ['rgb(20, 20, 20)', 'rgb(240, 240, 240)']) {
      (icon.element as HTMLElement).style.color = color;
      expect(getComputedStyle(icon.element).backgroundColor).toBe(color);
    }
    wrapper.unmount();
  });

  it('keeps the Claude mark in its brand colors unless a monochrome mark is requested', async () => {
    const wrapper = mount(ProviderIcon, { props: { provider: 'claude' } });
    expect(wrapper.get('img').attributes('src')).toBeTruthy();
    await wrapper.setProps({ monochrome: true });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.provider-icon').classes()).toContain('provider-icon--monochrome');
  });

  it('switches the shared icon when the provider changes', async () => {
    const wrapper = mount(ProviderIcon, { props: { provider: 'antigravity' } });
    const style = wrapper.get('.provider-icon').attributes('style');
    await wrapper.setProps({ provider: 'codex' });
    expect(wrapper.get('.provider-icon').attributes('style')).not.toBe(style);
    await wrapper.setProps({ provider: 'claude' });
    expect(wrapper.get('img').attributes('src')).toBeTruthy();
  });
});
