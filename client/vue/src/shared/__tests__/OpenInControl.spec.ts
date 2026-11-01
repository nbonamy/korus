import { flushPromises, mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import OpenInControl from '../OpenInControl.vue';

const catalog = {
  defaultApplication: 'vscode' as const,
  applications: [
    { id: 'vscode' as const, label: 'VS Code', iconDataUrl: 'data:image/png;base64,vscode' },
    { id: 'finder' as const, label: 'Finder', iconDataUrl: 'data:image/png;base64,finder' },
    { id: 'xcode' as const, label: 'Xcode', iconDataUrl: 'data:image/png;base64,xcode' },
  ],
};

describe('OpenInControl', () => {
  it('opens in the remembered application from the primary button', async () => {
    const wrapper = mount(OpenInControl, {
      props: { application: 'xcode', catalog },
    });

    expect(wrapper.get('[aria-label="Open in Xcode"] img').attributes('src')).toBe('data:image/png;base64,xcode');
    await wrapper.get('[aria-label="Open in Xcode"]').trigger('click');

    expect(wrapper.emitted('open')).toStrictEqual([['xcode']]);
  });

  it('renders the tighter borderless file-preview variant with its split divider', () => {
    const wrapper = mount(OpenInControl, {
      props: { application: 'vscode', catalog, variant: 'compact' },
    });

    expect(wrapper.classes()).toContain('open-in-control--compact');
    expect(wrapper.find('.open-in-control__menu-trigger').exists()).toBe(true);
  });

  it('shows applications outside the containing pane and opens the selected choice', async () => {
    const wrapper = mount(OpenInControl, {
      props: { application: 'vscode', catalog },
      attachTo: document.body,
      global: { components: { ElPopover }, stubs: { transition: false } },
    });

    await wrapper.get('[aria-label="Choose Open In application"]').trigger('click');
    await flushPromises();
    const menu = document.querySelector('[role="menu"][aria-label="Open in application"]')!;
    expect(menu).not.toBeNull();
    expect(wrapper.element.contains(menu)).toBe(false);
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map(item => item.textContent?.trim())).toStrictEqual(['VS Code', 'Finder', 'Xcode']);
    items[2]!.focus();
    await flushPromises();
    items[2]!.click();
    await flushPromises();

    expect(wrapper.emitted('open')).toStrictEqual([['xcode']]);
    await vi.waitFor(() => expect(menu.closest('[role="tooltip"]')!.getAttribute('aria-hidden')).toBe('true'));
    wrapper.unmount();
  });
});
