import { mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RepositoryIconPicker from '../RepositoryIconPicker.vue';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('RepositoryIconPicker', () => {
  it('reuses the full identity picker with a repository folder fallback', () => {
    const wrapper = mountPicker({ expanded: false });

    expect(wrapper.findComponent({ name: 'IdentityPicker' }).exists()).toBe(true);
    expect(wrapper.find('.tabler-icon-folder-root').exists()).toBe(true);
    expect(wrapper.find('.agent-avatar-picker__hint').exists()).toBe(false);
  });

  it('selects and clears a repository icon', async () => {
    const wrapper = mountPicker();

    await wrapper.get('[aria-label="Change icon for agent-workspace"]').trigger('click');
    expect(wrapper.get('.agent-avatar-picker__title').text()).toBe('Repository icon');
    const preset = wrapper.findAll('.agent-avatar-picker__preset').find((button) => button.text() === '🦞')!;
    await preset.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['🦞']]);

    await wrapper.setProps({ modelValue: '🦞' });
    await wrapper.get('[aria-label="Change icon for agent-workspace"]').trigger('click');
    const reset = wrapper.findAll('.agent-avatar-picker__preset')[0]!;
    expect(reset.attributes('aria-label')).toBe('Use default repository icon');
    await reset.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['🦞'], [undefined]]);
  });

  it('shows closed and open repository folder states without replacing a custom icon', async () => {
    const wrapper = mountPicker({ expanded: false });

    expect(wrapper.find('.tabler-icon-folder-root').exists()).toBe(true);
    await wrapper.setProps({ expanded: true });
    expect(wrapper.find('.tabler-icon-folder-open').exists()).toBe(true);
    await wrapper.setProps({ modelValue: '🦞' });
    expect(wrapper.get('.agent-avatar-picker__preview').text()).toBe('🦞');
    expect(wrapper.find('.tabler-icon-folder-open').exists()).toBe(false);
  });

  it('accepts one custom grapheme and rejects multiple characters', async () => {
    const wrapper = mountPicker();

    await wrapper.get('[aria-label="Change icon for agent-workspace"]').trigger('click');
    const input = wrapper.get('[aria-label="Custom repository icon"]');
    const apply = wrapper.get('[aria-label="Use custom repository icon"]');
    await input.setValue('AB');
    await apply.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await input.setValue('🦊');
    await apply.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['🦊']]);
  });

  it('supports selecting and cropping a repository image', async () => {
    class TestFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = 'data:image/png;base64,original';
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', TestFileReader);
    const wrapper = mountPicker();

    await wrapper.get('[aria-label="Change icon for agent-workspace"]').trigger('click');
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['icon'], 'icon.png', { type: 'image/png' })],
    });
    await input.trigger('change');
    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(true);

    await wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).vm.$emit('apply', 'data:image/png;base64,cropped');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['data:image/png;base64,cropped']]);
  });
});

function mountPicker(props: Partial<{ expanded: boolean; modelValue?: string }> = {}) {
  return mount(RepositoryIconPicker, {
    attachTo: document.body,
    props: {
      label: 'agent-workspace',
      ...props,
    },
    global: {
      components: { ElPopover },
      stubs: {
        teleport: true,
        AgentAvatarCropDialog: {
          name: 'AgentAvatarCropDialog',
          props: ['visible', 'image'],
          template: '<section v-if="visible" class="crop-dialog" />',
        },
      },
    },
  });
}
