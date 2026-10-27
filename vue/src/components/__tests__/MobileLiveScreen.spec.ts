import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileLiveScreen from '../MobileLiveScreen.vue';
import { setElectronTestClient } from '../../test/client';
import type { MobileViewRequest, MobileViewResult } from '@workspace/core/mobile-simulator';

function setup(startResult: MobileViewResult = { viewId: 'view' }) {
  const readers: {
    resolve(value: MobileViewResult): void;
    reject(error: Error): void;
  }[] = [];
  let serial = 0;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => `blob:frame-${++serial}`),
    revokeObjectURL: vi.fn(),
  });
  const mobileSimulatorView = vi.fn(
    async (_agent: string, input: MobileViewRequest): Promise<MobileViewResult> => {
      if (input.action === 'frame')
        return new Promise((resolve, reject) => readers.push({ resolve, reject }));
      return startResult;
    },
  );
  setElectronTestClient({ mobileSimulatorView });
  const wrapper = mount(MobileLiveScreen, {
    props: { agentId: 'a', attachmentId: 'device-session', disabled: false },
  });
  async function frame(rotation?: 0 | 1 | 2 | 3, viewId = 'view', size = { width: 1200, height: 2400 }, imageSize = size) {
    readers.shift()!.resolve({
      viewId,
      frame: {
        mimeType: 'image/jpeg',
        geometry: 0,
        ...(rotation === undefined ? {} : { rotation }),
        data: new Uint8Array([255, 216, 255, 217]),
        ...size,
      },
    });
    await flushPromises();
    Object.defineProperties(wrapper.get('img').element, {
      naturalWidth: { configurable: true, value: imageSize.width },
      naturalHeight: { configurable: true, value: imageSize.height },
    });
    await wrapper.get('img').trigger('load');
    await flushPromises();
  }
  return { wrapper, mobileSimulatorView, readers, frame };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('MobileLiveScreen', () => {
  it('ends a closed stream without showing an error or requesting another frame', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    try {
      await flushPromises();
      await frame();
      const readCount = mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'frame').length;
      readers.shift()!.resolve({ viewId: 'view', ended: true });
      await flushPromises();
      expect(wrapper.find('img').exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Reading');
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'frame')).toHaveLength(readCount);
      // Pause recovery must not reopen an attachment that has ended normally.
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await flushPromises();
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(1);
    } finally { wrapper.unmount(); visibility.mockRestore(); }
  });

  it('does not poll a view whose attachment ended while connecting', async () => {
    const { wrapper, mobileSimulatorView } = setup({ viewId: 'view', ended: true });
    try {
      await flushPromises();
      expect(mobileSimulatorView.mock.calls.some(([, input]) => input.action === 'frame')).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Reading');
    } finally { wrapper.unmount(); }
  });

  it('reconnects expired video to the same attachment without replaying a held gesture', async () => {
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    try {
      await flushPromises();
      await frame();
      const image = wrapper.get('img');
      vi.spyOn(image.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 600 } as DOMRect);
      image.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 20, bubbles: true }));
      await flushPromises();
      const touchCount = mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'touch').length;
      expect(touchCount).toBe(1);
      mobileSimulatorView.mockImplementationOnce(async () => ({ viewId: 'view' })); // old view cleanup
      mobileSimulatorView.mockImplementationOnce(async () => ({ viewId: 'recovered' }));
      readers.shift()!.reject(new Error("Error invoking remote method 'mobile:view': Error: Simulator view expired. Reconnect the view."));
      await flushPromises();
      expect(mobileSimulatorView).toHaveBeenLastCalledWith('a', { action: 'frame', attachmentId: 'device-session', viewId: 'recovered' });
      await frame(undefined, 'recovered');
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.get('img').attributes('src')).toBe('blob:frame-2');
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'touch')).toHaveLength(touchCount);
      // A later, independent pause is recoverable too, after healthy video resumed.
      readers.shift()!.reject(new Error('Simulator view expired. Reconnect the view.'));
      await flushPromises();
      await frame();
      expect(wrapper.get('img').attributes('src')).toBe('blob:frame-3');
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(3);
    } finally { wrapper.unmount(); }
  });

  it('bounds recovery attempts and leaves persistent failures recoverable through Retry', async () => {
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    try {
      await flushPromises();
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(readers).toHaveLength(1);
        readers.shift()!.reject(new Error('Simulator view expired. Reconnect the view.'));
        await flushPromises();
      }
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(2);
      expect(wrapper.get('[role="alert"]').text()).toContain('expired');
      await wrapper.get('[role="alert"] button').trigger('click');
      await flushPromises();
      await frame();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it.each(['frame read', 'image load'])('resumes a paused %s on focus and ignores superseded work', async (phase) => {
    vi.useFakeTimers();
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    try {
      await flushPromises();
      const paused = readers.shift()!;
      let oldImage: ReturnType<typeof wrapper.get> | undefined;
      if (phase === 'image load') {
        paused.resolve({ viewId: 'view', frame: { mimeType: 'image/jpeg', geometry: 0, data: new Uint8Array([1]), width: 1200, height: 2400 } });
        await flushPromises(); // Intentionally no image load event before the pause.
        oldImage = wrapper.get('img');
      }
      await vi.advanceTimersByTimeAsync(16_000);
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus')); // no overlapping recovery
      await flushPromises();
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(2);
      if (phase === 'frame read') paused.reject(new Error('Simulator view expired. Reconnect the view.'));
      await flushPromises();
      await frame();
      await oldImage?.trigger('error');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.get('img').attributes('src')).toBe(phase === 'frame read' ? 'blob:frame-1' : 'blob:frame-2');
    } finally { wrapper.unmount(); }
    window.dispatchEvent(new Event('focus'));
    expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(2);
  });

  it('stops hidden video and resumes the same attachment without displaying stale failures', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    try {
      await flushPromises();
      const paused = readers.shift()!;
      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await flushPromises();
      expect(mobileSimulatorView).toHaveBeenLastCalledWith('a', { action: 'stop', attachmentId: 'device-session', viewId: 'view' });
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await flushPromises();
      paused.reject(new Error('Simulator view expired. Reconnect the view.'));
      await flushPromises();
      await frame();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(2);
    } finally { wrapper.unmount(); visibility.mockRestore(); }
  });

  it('puts working buttons on the frame, separate volume keys, following the device as it turns', async () => {
    const { wrapper, frame } = setup();
    await flushPromises();
    await frame();
    const edges = () => Object.fromEntries(wrapper.findAll('.mobile-live-screen__hw').map((button) => [button.attributes('aria-label'), button.classes().find((name) => name.includes('--'))]));
    expect(edges()).toEqual({
      'Volume up': 'mobile-live-screen__hw--left',
      'Volume down': 'mobile-live-screen__hw--left',
      Power: 'mobile-live-screen__hw--right',
    });
    const [up, down] = wrapper.findAll('.mobile-live-screen__hw');
    expect(up!.attributes('style')).toContain('top: 20%');
    expect(down!.attributes('style')).toContain('top: 31%'); // a gap remains between the two volume keys
    await down!.trigger('click');
    expect(wrapper.emitted('button')).toEqual([['volumeDown']]);
    await frame(1); // clockwise quarter turn: left edge becomes the top, right edge the bottom
    expect(edges()).toEqual({
      'Volume up': 'mobile-live-screen__hw--top',
      'Volume down': 'mobile-live-screen__hw--top',
      Power: 'mobile-live-screen__hw--bottom',
    });
    await wrapper.setProps({ platform: 'android', disabled: true });
    expect(wrapper.findAll('.mobile-live-screen__hw').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('frames the device for its platform and orientation', async () => {
    const { wrapper, frame } = setup();
    await flushPromises();
    await frame();
    const device = wrapper.get('.mobile-live-screen__device');
    expect(device.attributes('data-platform')).toBe('ios');
    expect(device.attributes('data-landscape')).toBe('false');
    await wrapper.setProps({ platform: 'android' });
    expect(device.attributes('data-platform')).toBe('android');
    await frame(1);
    expect(wrapper.get('.mobile-live-screen__device').attributes('data-landscape')).toBe('true');
    await wrapper.setProps({ platform: 'ios', foldable: true });
    await frame(0, 'view', { width: 1398, height: 2034 });
    expect(wrapper.get('[aria-label="Volume up"]').classes()).toContain('mobile-live-screen__hw--top');
    expect(wrapper.get('[aria-label="Volume up"]').attributes('style')).toContain('left: 45%');
    await frame(0, 'view', { width: 2853, height: 2007 }, { width: 1004, height: 1426 });
    expect(wrapper.get('[aria-label="Volume up"]').attributes('style')).toContain('left: 73%');
    const shape = (device.element as HTMLElement).style.getPropertyValue('--mobile-screen-ratio');
    expect(device.attributes('data-image-rotation')).toBe('1');
    // The native stream can also deliver an already-wide buffer after unfolding.
    await frame(0, 'view', { width: 2853, height: 2007 }, { width: 1426, height: 1004 });
    expect(device.attributes('data-image-rotation')).toBe('0');
    expect((device.element as HTMLElement).style.getPropertyValue('--mobile-screen-ratio')).toBe(shape);
    await frame(1, 'view', { width: 2007, height: 2853 }, { width: 1004, height: 1426 });
    expect((device.element as HTMLElement).style.getPropertyValue('--mobile-screen-ratio')).toBe(shape);
    expect(device.attributes('data-image-rotation')).toBe('1');
    await wrapper.get('[aria-label="Volume up"]').trigger('click');
    expect(wrapper.emitted('button')).toEqual([['volumeUp']]);
  });

  it.each([
    [1, 'landscape', 0.25, 0.5, 600, 600],
    [3, 'landscape', 0.75, 0.25, 1800, 300],
    [2, 'portrait', 0.25, 0.5, 300, 1200],
  ] as const)('sends taps in the upright space of a framebuffer shown with %i clockwise quarter turns', async (turns, shape, u, v, expectedX, expectedY) => {
    const { wrapper, mobileSimulatorView, frame } = setup();
    await flushPromises();
    await frame(turns);
    const device = wrapper.get('.mobile-live-screen__device');
    expect(device.attributes('data-rotation')).toBe(String(turns));
    expect(device.attributes('style')).toContain(shape === 'landscape' ? '--mobile-screen-ratio: 2' : '--mobile-screen-ratio: 0.5');
    const image = wrapper.get('img');
    vi.spyOn(image.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);
    const pointer = (name: string, x: number, y: number) =>
      image.element.dispatchEvent(new MouseEvent(name, { button: 0, clientX: x, clientY: y, bubbles: true }));
    pointer('pointerdown', 400 * u, 400 * v);
    await flushPromises();
    const touch = mobileSimulatorView.mock.calls.find(([, input]) => input.action === 'touch')![1] as { x: number; y: number };
    expect([touch.x, touch.y]).toEqual([expectedX, expectedY]);
  });

  it('renders video during a held drag and coalesces moves without losing release', async () => {
    const { wrapper, mobileSimulatorView, frame } = setup();
    await flushPromises();
    await frame();
    const image = wrapper.get('img');
    wrapper.get('.mobile-live-screen__device').element.dispatchEvent(
      new MouseEvent('pointerdown', {
        button: 0,
        clientX: 2,
        clientY: 2,
        bubbles: true,
      }),
    );
    expect(mobileSimulatorView.mock.calls.some(([, input]) => input.action === 'touch')).toBe(false);
    vi.spyOn(image.element, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 300,
      height: 600,
    } as DOMRect);
    const pointer = (name: string, x: number, y: number) =>
      image.element.dispatchEvent(
        new MouseEvent(name, {
          button: 0,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
    pointer('pointerdown', 110, 420);
    await flushPromises();
    expect(mobileSimulatorView).toHaveBeenCalledWith('a', {
      action: 'touch',
      geometry: 0,
      attachmentId: 'device-session',
      viewId: 'view',
      phase: 'down',
      x: 400,
      y: 1600,
    });
    let finish!: (value: MobileViewResult) => void;
    mobileSimulatorView.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    pointer('pointermove', 110, 320);
    pointer('pointermove', 110, 270);
    pointer('pointermove', 110, 220);
    await frame();
    expect(image.attributes('src')).toBe('blob:frame-2');
    expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'touch')).toHaveLength(2);
    pointer('pointerup', 110, 200);
    finish({ viewId: 'view' });
    await flushPromises();
    expect(
      mobileSimulatorView.mock.calls
        .filter(([, input]) => input.action === 'touch')
        .map(([, input]) => input),
    ).toEqual([
      {
        action: 'touch',
        geometry: 0,
        attachmentId: 'device-session',
        viewId: 'view',
        phase: 'down',
        x: 400,
        y: 1600,
      },
      {
        action: 'touch',
        geometry: 0,
        attachmentId: 'device-session',
        viewId: 'view',
        phase: 'move',
        x: 400,
        y: 1200,
      },
      {
        action: 'touch',
        geometry: 0,
        attachmentId: 'device-session',
        viewId: 'view',
        phase: 'up',
        x: 400,
        y: 720,
      },
    ]);
    wrapper.unmount();
    expect(mobileSimulatorView).toHaveBeenCalledWith('a', {
      action: 'stop',
      attachmentId: 'device-session',
      viewId: 'view',
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-2');
  });

  it('renders Android PNG bytes and keeps the displayed frame across idle heartbeats', async () => {
    const { wrapper, readers } = setup();
    await flushPromises();
    readers
      .shift()!
      .resolve({
        viewId: 'view',
        frame: {
          data: new Uint8Array([137, 80, 78, 71]),
          mimeType: 'image/png',
          width: 1080,
          height: 2400,
          geometry: 0,
        },
      });
    await flushPromises();
    await wrapper.get('img').trigger('load');
    await flushPromises();
    const source = wrapper.get('img').attributes('src');
    expect(vi.mocked(URL.createObjectURL).mock.calls[0]![0]).toHaveProperty('type', 'image/png');
    readers.shift()!.resolve({ viewId: 'view' });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(source);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(readers).toHaveLength(1);
    wrapper.unmount();
  });
  it('discards old-agent frames, reports stream failure, and reconnects through the visible retry', async () => {
    const { wrapper, mobileSimulatorView, readers, frame } = setup();
    await flushPromises();
    const stale = readers.shift()!;
    await wrapper.setProps({ agentId: 'b', attachmentId: 'other-session' });
    await flushPromises();
    stale.resolve({
      viewId: 'view',
      frame: { mimeType: 'image/jpeg', geometry: 0, data: new Uint8Array([1]), width: 1200, height: 2400 },
    });
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    await frame();
    readers.shift()!.reject(new Error('Simulator disconnected'));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Simulator disconnected');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(mobileSimulatorView.mock.calls.filter(([, input]) => input.action === 'start')).toHaveLength(2);
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    await frame();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(mobileSimulatorView).toHaveBeenCalledWith('b', {
      action: 'start',
      attachmentId: 'other-session',
    });
    wrapper.unmount();
  });
});
