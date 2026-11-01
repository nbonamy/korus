import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import ImagePreviewPanel from '../ImagePreviewPanel.vue';

const panel = {
  kind: 'image' as const,
  title: 'diagram.png',
  subtitle: '/repo/diagram.png',
  path: '/repo/diagram.png',
  src: 'data:image/png;base64,aW1hZ2U=',
  alt: 'Architecture diagram',
  mimeType: 'image/png',
  state: 'idle' as const,
  error: null,
};

describe('ImagePreviewPanel', () => {
  it('renders the renderer-safe image source with its accessible description', () => {
    const wrapper = mount(ImagePreviewPanel, {
      props: { panel },
    });

    expect(wrapper.attributes('aria-label')).toBe('diagram.png');
    expect(wrapper.get('img').attributes()).toMatchObject({
      alt: 'Architecture diagram',
      src: 'data:image/png;base64,aW1hZ2U=',
    });
  });

  it('zooms around native trackpad pinch events without consuming ordinary scrolling', async () => {
    const wrapper = mount(ImagePreviewPanel, { props: { panel } });
    const viewport = wrapper.get<HTMLElement>('.image-preview-panel__viewport').element;
    const stage = wrapper.get<HTMLElement>('.image-preview-panel__stage').element;
    const image = wrapper.get<HTMLImageElement>('img').element;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 400 },
    });
    await wrapper.get('img').trigger('load');
    await nextTick();
    const initialWidth = Number.parseFloat(stage.style.width);
    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, right: 420, top: 50, bottom: 250, width: 400, height: 200 }),
    });

    const scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 20 });
    viewport.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(Number.parseFloat(stage.style.width)).toBe(initialWidth);

    const pinch = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 220,
      clientY: 150,
      ctrlKey: true,
      deltaY: -20,
    });
    viewport.dispatchEvent(pinch);
    await nextTick();

    expect(pinch.defaultPrevented).toBe(true);
    const zoomedWidth = Number.parseFloat(stage.style.width);
    expect(zoomedWidth).toBeGreaterThan(initialWidth);

    const pinchOut = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 220,
      clientY: 150,
      ctrlKey: true,
      deltaY: 20,
    });
    viewport.dispatchEvent(pinchOut);
    await nextTick();

    expect(pinchOut.defaultPrevented).toBe(true);
    expect(Number.parseFloat(stage.style.width)).toBeLessThan(zoomedWidth);
  });
});
