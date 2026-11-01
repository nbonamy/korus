import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  window.history.replaceState({}, '', '/');
  delete document.documentElement.dataset.surface;
});

describe('AnnotationOverlayApp', () => {
  it('submits and cancels comments with the URL-provided token and anchor', async () => {
    window.history.replaceState({}, '', '/?token=annotation-1&description=Save&anchor=%7B%22x%22%3A20%2C%22y%22%3A30%2C%22width%22%3A40%2C%22height%22%3A50%7D');
    const browserResolveAnnotation = vi.fn().mockResolvedValue(undefined);
    vi.resetModules();
    const { configureAppClient } = await import('../platform-api');
    configureAppClient({
      api: { browserResolveAnnotation } as never,
      platform: 'desktop',
    });
    const AnnotationOverlayApp = (await import('../AnnotationOverlayApp.vue')).default;
    const wrapper = mount(AnnotationOverlayApp);

    expect(wrapper.get('form').attributes('aria-description')).toBe('Save');
    expect(wrapper.get('form').attributes('style')).toContain('left: 20px');
    await wrapper.get('input').setValue('  tighten spacing  ');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('keydown', { key: 'Escape' });
    await flushPromises();

    expect(browserResolveAnnotation.mock.calls).toStrictEqual([
      ['annotation-1', 'tighten spacing'],
      ['annotation-1', null],
    ]);
  });

  it('uses a safe anchor and ignores resolution when the token is absent', async () => {
    window.history.replaceState({}, '', '/?anchor=not-json');
    const browserResolveAnnotation = vi.fn();
    vi.resetModules();
    const { configureAppClient } = await import('../platform-api');
    configureAppClient({
      api: { browserResolveAnnotation } as never,
      platform: 'desktop',
    });
    const AnnotationOverlayApp = (await import('../AnnotationOverlayApp.vue')).default;
    const wrapper = mount(AnnotationOverlayApp);
    expect(wrapper.get('form').attributes('style')).toContain('left: 12px');
    await wrapper.get('input').setValue('comment');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(browserResolveAnnotation).not.toHaveBeenCalled();
  });
});

describe('annotation overlay background isolation', () => {
  it.each(['main', 'annotation-overlay'])('limits transparent page styling to the overlay surface (%s)', async (surface) => {
    document.documentElement.dataset.surface = surface;
    const AnnotationOverlayApp = (await import('../AnnotationOverlayApp.vue')).default;
    const wrapper = mount(AnnotationOverlayApp, {
      attachTo: document.body,
      global: { stubs: { AnnotationPopup: true } },
    });

    expect(wrapper.find('.annotation-overlay').exists()).toBe(true);
    expect(getComputedStyle(document.body).getPropertyValue('background')).toBe(
      surface === 'annotation-overlay' ? 'transparent' : '',
    );
  });
});
