import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import SettingsAppearancePanel from '../SettingsAppearancePanel.vue';
import { defaultThemeSettings } from '@workspace/core/settings';

describe('SettingsAppearancePanel', () => {
  it('emits appearance setting updates', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsAppearancePanel, {
      props: {
        settings: defaultThemeSettings,
        updateSettings,
      },
      global: {
        },
    });

    expect(wrapper.text()).not.toContain('UI font size');
    expect(wrapper.text()).toContain('Color');
    expect(wrapper.text()).toContain('Typography');
    expect(wrapper.text()).toContain('Diff preview');
    expect(wrapper.text()).toContain('Select the color palette used across the app');
    expect(wrapper.text()).toContain('src/theme.ts');
    expect(wrapper.text()).toContain('28 unmodified lines');
    expect(wrapper.text()).toContain("accent: 'app'");
    expect(wrapper.findAll('.git-diff-preview-panel__line--added')).toHaveLength(1);
    expect(wrapper.findAll('.git-diff-preview-panel__line--deleted')).toHaveLength(1);
    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'dark');
    await wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'github-dark');
    await wrapper.findAllComponents({ name: 'ElInputNumber' })[0].vm.$emit('update:modelValue', 17);
    await wrapper.findAllComponents({ name: 'ElInputNumber' })[1].vm.$emit('update:modelValue', 15);

    expect(updateSettings).toHaveBeenCalledWith({ theme: { mode: 'dark', id: 'app-dark' } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { id: 'github-dark' } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { chatFontSize: 17 } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { codeFontSize: 15 } });
  });

  it('hands the default dark theme back to the system when switching to system mode, but keeps other explicit themes', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsAppearancePanel, {
      props: {
        settings: {
          ...defaultThemeSettings,
          id: 'app-dark',
          mode: 'dark',
        },
        updateSettings,
      },
      global: {
        },
    });

    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'system');
    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'dark');

    expect(updateSettings).toHaveBeenCalledWith({ theme: { mode: 'system', id: 'app-light' } });
    expect(updateSettings).toHaveBeenCalledWith({ theme: { mode: 'dark', id: 'app-dark' } });

    await wrapper.setProps({ settings: { ...defaultThemeSettings, id: 'one-dark-pro', mode: 'dark' } });
    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'system');
    expect(updateSettings).toHaveBeenLastCalledWith({ theme: { mode: 'system' } });
  });

  it('ignores invalid mode and numeric updates', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsAppearancePanel, {
      props: {
        settings: defaultThemeSettings,
        updateSettings,
      },
      global: {
        },
    });

    await wrapper.findComponent({ name: 'ElSegmented' }).vm.$emit('update:modelValue', 'neon');
    await wrapper.findAllComponents({ name: 'ElInputNumber' })[0].vm.$emit('update:modelValue', null);

    expect(updateSettings).not.toHaveBeenCalled();
  });
});
