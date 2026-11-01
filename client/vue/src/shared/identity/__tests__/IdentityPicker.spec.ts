import { mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IdentityPicker from '../IdentityPicker.vue';

describe('IdentityPicker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a compact popover and emits preset selections', async () => {
    const wrapper = mountPicker();

    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');

    expect(wrapper.find('.agent-avatar-picker__popover').exists()).toBe(true);
    const presets = wrapper.findAll('.agent-avatar-picker__preset').map((button) => button.text());
    expect(presets).toEqual(expect.arrayContaining(['🤖', '🦞', '🎵', '🎾']));
    expect(presets).not.toEqual(expect.arrayContaining(['✺', '◎', '▮', '▻', '⌨️']));
    expect(wrapper.findAll('.identity-picker__preset-glyph')).toHaveLength(presets.length - 1);

    await wrapper.findAll('.agent-avatar-picker__preset').find((button) => button.text() === '🤖')?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['🤖']]);
    expect(wrapper.getComponent({ name: 'ElPopover' }).props('visible')).toBe(false);
  });

  it('uses catalog copy for the shared defaults', async () => {
    const wrapper = mount(IdentityPicker, {
      props: { name: 'Dina' },
      global: { stubs: { teleport: true, AgentAvatarCropDialog: true } },
    });

    expect(wrapper.get('.agent-avatar-picker__trigger').attributes('aria-label')).toBe('Change identity');
    expect(wrapper.get('.agent-avatar-picker__hint').text()).toBe('Click to change');
    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    expect(wrapper.findAll('.agent-avatar-picker__preset').find((button) => button.text() === '🤖')?.attributes('aria-label'))
      .toBe('Use 🤖 identity');
    expect(wrapper.get('.agent-avatar-picker__custom').attributes('title'))
      .toBe('Enter one character, or press Control-Command-Space on macOS');
  });

  it('accepts one custom grapheme and rejects multiple characters', async () => {
    const wrapper = mountPicker({ modelValue: '🤖' });
    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    const custom = wrapper.get<HTMLInputElement>('.agent-avatar-picker__custom');
    expect(custom.attributes('placeholder')).toBe('…');
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Use custom avatar"]').element.disabled).toBe(true);

    await custom.trigger('focus');
    expect(custom.classes()).toContain('agent-avatar-picker__custom--active');
    expect(wrapper.findAll('.agent-avatar-picker__preset').find((button) => button.text() === '🤖')?.attributes('aria-pressed')).toBe('false');

    await custom.setValue('🎾🎵');
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Use custom avatar"]').element.disabled).toBe(false);
    await wrapper.get('[aria-label="Use custom avatar"]').trigger('click');
    expect(custom.attributes('aria-invalid')).toBe('true');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    await custom.setValue('👨‍💻');
    await wrapper.get('[aria-label="Use custom avatar"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['👨‍💻']]);
    expect(wrapper.getComponent({ name: 'ElPopover' }).props('visible')).toBe(false);
  });

  it('prefills and selects a saved custom character', async () => {
    const wrapper = mountPicker({ modelValue: '🫠' });
    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');

    const custom = wrapper.get<HTMLInputElement>('.agent-avatar-picker__custom');
    expect(custom.element.value).toBe('🫠');
    expect(custom.classes()).toContain('agent-avatar-picker__custom--active');
    expect(wrapper.find('[aria-label="Use custom avatar"]').exists()).toBe(true);
  });

  it('emits undefined when initials are selected', async () => {
    const wrapper = mountPicker({ modelValue: '🤖', name: 'Dina Bot' });

    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    const initialsButton = wrapper.findAll('.agent-avatar-picker__preset')[0];
    expect(initialsButton.attributes('aria-label')).toBe('Use initials');
    await initialsButton.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toStrictEqual([[undefined]]);
  });

  it('opens the image picker from the popover action', async () => {
    const wrapper = mountPicker();
    await wrapper.get('.agent-avatar-picker__hint').trigger('click');
    const input = wrapper.get('input[type="file"]');
    const click = vi.spyOn(input.element as HTMLInputElement, 'click').mockImplementation(() => undefined);

    await wrapper.get('.agent-avatar-picker__choose-image').trigger('click');

    expect(click).toHaveBeenCalledOnce();
    expect(wrapper.find('.agent-avatar-picker__popover').exists()).toBe(true);
  });

  it('opens the image crop dialog after a file is selected and emits cropped image output', async () => {
    const wrapper = mountPicker();
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    class TestFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = 'data:image/png;base64,original';
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', TestFileReader);

    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [file],
    });
    await input.trigger('change');

    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(true);
    await wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).vm.$emit('apply', 'data:image/png;base64,cropped');

    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['data:image/png;base64,cropped']]);
    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(false);
  });

  it('ignores empty file selections and non-string reader results', async () => {
    const wrapper = mountPicker();
    class TestFileReader {
      result: string | ArrayBuffer | null = new ArrayBuffer(1);
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', TestFileReader);

    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [],
    });
    await input.trigger('change');

    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(false);

    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['avatar'], 'avatar.png', { type: 'image/png' })],
    });
    await input.trigger('change');

    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(false);
  });

  it('cancels pending image crops without changing the avatar', async () => {
    const wrapper = mountPicker();
    class TestFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(): void {
        this.result = 'data:image/png;base64,original';
        this.onload?.();
      }
    }
    vi.stubGlobal('FileReader', TestFileReader);

    await wrapper.get('.agent-avatar-picker__trigger').trigger('click');
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['avatar'], 'avatar.png', { type: 'image/png' })],
    });
    await input.trigger('change');
    await wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).vm.$emit('cancel');

    expect(wrapper.findComponent({ name: 'AgentAvatarCropDialog' }).props('visible')).toBe(false);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});

function mountPicker(props: Partial<{
  modelValue?: string;
  name: string;
}> = {}) {
  return mount(IdentityPicker, {
    props: {
      customApplyAriaLabel: 'Use custom avatar',
      customCharacterAriaLabel: 'Custom avatar character',
      emptyLabel: 'Use initials',
      name: 'Dina',
      presetNoun: 'avatar',
      ...props,
    },
    global: {
      components: { ElPopover },
      stubs: {
        teleport: true,
        AgentAvatarCropDialog: {
          name: 'AgentAvatarCropDialog',
          props: ['visible', 'image'],
          template: '<section v-if="visible" class="crop-dialog"><slot /></section>',
        },
      },
    },
  });
}
