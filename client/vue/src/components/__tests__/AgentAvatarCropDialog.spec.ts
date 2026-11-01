import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import AgentAvatarCropDialog from '../AgentAvatarCropDialog.vue';
import * as crop from '../agent-avatar-crop';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentAvatarCropDialog', () => {
  it('renders a focused adjust-avatar modal and emits cropped output', async () => {
    vi.spyOn(crop, 'cropImageDataUrl').mockResolvedValue('data:image/png;base64,cropped');
    const wrapper = mount(AgentAvatarCropDialog, {
      props: {
        image: 'data:image/png;base64,original',
        visible: true,
      },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: `
              <section v-if="modelValue" class="crop-shell">
                <slot name="header" />
                <slot />
                <slot name="footer" />
              </section>
            `,
          },
        },
      },
    });

    expect(wrapper.text()).toContain('Adjust Avatar');
    expect(wrapper.find('.agent-avatar-crop-dialog__stage img').attributes('src')).toBe('data:image/png;base64,original');
    expect(wrapper.findAll('.app-button').map((button) => button.classes())).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);
    await wrapper.get('input[type="range"]').setValue('1.5');
    await wrapper.findAll('button').find((button) => button.text() === 'Use Image')?.trigger('click');

    expect(crop.cropImageDataUrl).toHaveBeenCalledWith('data:image/png;base64,original', 1.5, { x: 0, y: 0 }, 200);
    expect(wrapper.emitted('apply')).toStrictEqual([['data:image/png;base64,cropped']]);
  });

  it('pans a zoomed image and applies that offset to the crop', async () => {
    vi.spyOn(crop, 'cropImageDataUrl').mockResolvedValue('data:image/png;base64,cropped');
    const wrapper = mount(AgentAvatarCropDialog, {
      props: {
        image: 'data:image/png;base64,original',
        visible: true,
      },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: `
              <section v-if="modelValue" class="crop-shell">
                <slot name="header" />
                <slot />
                <slot name="footer" />
              </section>
            `,
          },
        },
      },
    });
    const image = wrapper.get('.agent-avatar-crop-dialog__stage img');
    Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: 300 });
    Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: 300 });
    Object.defineProperty(image.element, 'setPointerCapture', { configurable: true, value: vi.fn() });

    await image.trigger('load');
    await wrapper.get('input[type="range"]').setValue('2');
    await dispatchPointerEvent(image.element, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
    await dispatchPointerEvent(image.element, 'pointermove', { clientX: 130, clientY: 85, pointerId: 1 });
    await dispatchPointerEvent(image.element, 'pointerup', { clientX: 130, clientY: 85, pointerId: 1 });

    expect(image.attributes('style')).toContain('translate(30px, -15px) scale(2)');

    await wrapper.findAll('button').find((button) => button.text() === 'Use Image')?.trigger('click');

    expect(crop.cropImageDataUrl).toHaveBeenCalledWith('data:image/png;base64,original', 2, { x: 30, y: -15 }, 200);
  });

  it('emits cancel from the footer action', async () => {
    const wrapper = mount(AgentAvatarCropDialog, {
      props: {
        image: 'data:image/png;base64,original',
        visible: true,
      },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: '<section v-if="modelValue"><slot name="header" /><slot /><slot name="footer" /></section>',
          },
        },
      },
    });

    await wrapper.findAll('button').find((button) => button.text() === 'Cancel')?.trigger('click');

    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
  });

  it('does not emit apply when there is no selected image', async () => {
    const applyCrop = vi.spyOn(crop, 'cropImageDataUrl');
    const wrapper = mount(AgentAvatarCropDialog, {
      props: {
        image: null,
        visible: true,
      },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: '<section v-if="modelValue"><slot name="header" /><slot /><slot name="footer" /></section>',
          },
        },
      },
    });

    await wrapper.findAll('button').find((button) => button.text() === 'Use Image')?.trigger('click');

    expect(applyCrop).not.toHaveBeenCalled();
    expect(wrapper.emitted('apply')).toBeUndefined();
  });
});

async function dispatchPointerEvent(element: Element, type: string, init: { clientX: number; clientY: number; pointerId: number }): Promise<void> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerId: { value: init.pointerId },
  });
  element.dispatchEvent(event);
  await nextTick();
}
