import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import SettingsAppearancePanel from '../SettingsAppearancePanel.vue';
import { defaultThemeSettings } from '@workspace/core/settings';
import { parseCustomTheme } from '@workspace/core/custom-themes';
import { setElectronTestClient } from '../../../tests/support/client';
import { appMessageBox } from '../../shared/dialog/message-box';

const ElOptionGroup = defineComponent({
  props: ['label'],
  template: '<optgroup :label="label"><slot /></optgroup>',
});

describe('SettingsAppearancePanel', () => {
  it('refreshes saved skins when opening the picker and deletes only after confirmation', async () => {
    const moss = parseCustomTheme({ version: 1, name: 'Moss', appearance: 'dark', colors: { canvas: '#12150f' } });
    const listLocalSkins = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValue([{ name: 'moss', skin: moss }]);
    const deleteLocalSkin = vi.fn().mockResolvedValue(undefined);
    setElectronTestClient({ listLocalSkins, deleteLocalSkin });
    const fetch = vi.fn(async () => Response.json({ pageCount: 1, skins: [{ slug: 'nebula', name: 'Nebula' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    // Confirm resolves to an action string in Element Plus at runtime.
    const confirm = vi.spyOn(appMessageBox, 'confirm').mockRejectedValueOnce('cancel')
      .mockResolvedValueOnce('confirm' as Awaited<ReturnType<typeof appMessageBox.confirm>>);
    try {
      const updateSettings = vi.fn().mockResolvedValue(undefined);
      const wrapper = mount(SettingsAppearancePanel, {
        props: { settings: defaultThemeSettings, updateSettings },
        global: { components: { ElOptionGroup } },
      });
      const picker = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('aria-label') === 'Skin')!;
      const groups = () => picker.findAll('optgroup').map(group => group.attributes('label'));
      async function openPicker() {
        picker.vm.$emit('visibleChange', true);
        await flushPromises();
      }

      await openPicker();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      await openPicker();
      expect(groups()).toStrictEqual(['t3skins.dev']);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(picker.get('a[aria-label="Preview Nebula"]').attributes('href')).toBe('https://www.t3skins.dev/skins/nebula');
      await openPicker();
      expect(groups()).toStrictEqual(['Local skins', 't3skins.dev']);
      expect(picker.findAll('option').map(option => option.text())).toStrictEqual(['Load from file…', 'Moss', 'Nebula']);
      picker.vm.$emit('update:modelValue', 'local:moss');
      await flushPromises();
      expect(updateSettings).toHaveBeenCalledWith({ theme: { skin: moss } });
      await wrapper.setProps({ settings: { ...defaultThemeSettings, skin: moss } });
      expect(picker.props('modelValue')).toBe('local:moss');

      const remove = picker.get('button[aria-label="Delete Moss"]');
      await remove.trigger('click');
      await flushPromises();
      expect(deleteLocalSkin).not.toHaveBeenCalled();
      await remove.trigger('click');
      await flushPromises();
      expect(deleteLocalSkin).toHaveBeenCalledExactlyOnceWith('moss');
      expect(picker.find('button[aria-label="Delete Moss"]').exists()).toBe(false);
      expect(groups()).toStrictEqual(['t3skins.dev']);
    } finally {
      confirm.mockRestore();
    }
  });

  it('shows a load error and keeps the active skin after an invalid catalog import', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ version: 99 })));
    const skin = parseCustomTheme({ version: 1, name: 'Moss', appearance: 'dark', colors: { canvas: '#12150f' } });
    const updateSettings = vi.fn();
    const wrapper = mount(SettingsAppearancePanel, { props: { settings: { ...defaultThemeSettings, skin }, updateSettings } });
    const picker = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('aria-label') === 'Skin')!;

    picker.vm.$emit('update:modelValue', 'invalid');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Unable to load this skin');
    expect(wrapper.find('button[title="Remove Moss"]').exists()).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
  });

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
    expect(wrapper.get('a[href="https://www.t3skins.dev"]').attributes('target')).toBe('_blank');
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
