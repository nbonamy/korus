import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BackendIcon from '../BackendIcon.vue';

describe('BackendIcon', () => {
  it.each(['codex', 'antigravity'] as const)('renders the %s mark in the surrounding text color so it follows the theme', (backend) => {
    const wrapper = mount(BackendIcon, { props: { backend }, attachTo: document.body });
    const icon = wrapper.get('.backend-icon');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(getComputedStyle(icon.element).maskImage).toContain('url(');
    for (const color of ['rgb(20, 20, 20)', 'rgb(240, 240, 240)']) {
      (icon.element as HTMLElement).style.color = color;
      expect(getComputedStyle(icon.element).backgroundColor).toBe(color);
    }
    wrapper.unmount();
  });

  it('keeps the Claude mark in its brand colors unless a monochrome mark is requested', async () => {
    const wrapper = mount(BackendIcon, { props: { backend: 'claude' } });
    expect(wrapper.get('img').attributes('src')).toBeTruthy();
    await wrapper.setProps({ monochrome: true });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.backend-icon').classes()).toContain('backend-icon--monochrome');
  });

  it('switches the shared icon when the provider changes', async () => {
    const wrapper = mount(BackendIcon, { props: { backend: 'antigravity' } });
    const style = wrapper.get('.backend-icon').attributes('style');
    await wrapper.setProps({ backend: 'codex' });
    expect(wrapper.get('.backend-icon').attributes('style')).not.toBe(style);
    await wrapper.setProps({ backend: 'claude' });
    expect(wrapper.get('img').attributes('src')).toBeTruthy();
  });
});
