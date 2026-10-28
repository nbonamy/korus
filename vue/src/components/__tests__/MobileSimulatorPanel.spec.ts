import { flushPromises, mount } from '@vue/test-utils';
import { ElSegmented } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileSimulatorPanel from '../MobileSimulatorPanel.vue';
import { setElectronTestClient } from '../../test/client';
import type { MobileDevice, MobileRequest, MobileViewRequest, MobileViewResult } from '@workspace/core/mobile-simulator';
const attachment = {
  id: 'session',
  device: { id: 'phone', name: 'Pixel', platform: 'android' as const, state: 'booted' as const },
};
const frame = {
  attachmentId: 'session',
  data: 'cG5n',
  mimeType: 'image/png' as const,
  width: 1200,
  height: 2400,
  scale: 3,
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(attached = true, device: MobileDevice = attachment.device) {
  vi.useFakeTimers();
  const current = { ...attachment, device };
  let shutdownGate: Promise<void> | undefined;
  const mobileSimulator = vi.fn(async (_agent: string, input: MobileRequest) => {
    if (input.action === 'attach') attached = true;
    if (input.action === 'shutdown') await shutdownGate;
    if (input.action === 'detach' || input.action === 'shutdown') attached = false;
    return {
      attachment: attached ? current : null,
      ...(input.action === 'list' ? { catalog: { devices: [device], setup: [] } } : {}),
      ...(input.action === 'screenshot' ? { frame } : {}),
    };
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:native-frame'), revokeObjectURL: vi.fn() });
  const mobileSimulatorView = vi.fn(async (_agent: string, input: MobileViewRequest): Promise<MobileViewResult> => {
    if (input.action === 'frame') return { viewId: 'view', frame: { data: new Uint8Array([1]), mimeType: 'image/png', geometry: 0, width: 1200, height: 2400 } };
    return { viewId: 'view' };
  });
  setElectronTestClient({ mobileSimulator, mobileSimulatorView });
  const holdShutdown = () => {
    let release!: () => void;
    shutdownGate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  };
  return { mobileSimulator, mobileSimulatorView, holdShutdown, wrapper: mount(MobileSimulatorPanel, { props: { agentId: 'a', visible: true } }) };
}

describe('MobileSimulatorPanel', () => {
  it('folds and unfolds a Duo and starts a fresh live view for each screen size', async () => {
    const { wrapper, mobileSimulator, mobileSimulatorView } = setup(true, { ...attachment.device, platform: 'ios', name: 'My Duo', foldable: true });
    try {
      await flushPromises();
      for (const [label, action] of [['Fold', 'fold'], ['Unfold', 'unfold']] as const) {
        let release!: () => void;
        mobileSimulator.mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => { release = resolve; });
          return { attachment: { ...attachment, device: { ...attachment.device, platform: 'ios', foldable: true } } };
        });
        const starts = mobileSimulatorView.mock.calls.filter(([, request]) => request.action === 'start').length;
        await wrapper.get(`[aria-label="${label}"]`).trigger('click');
        await flushPromises();
        expect(mobileSimulator).toHaveBeenCalledWith('a', { action, attachmentId: 'session' });
        expect(wrapper.get('[role="status"]').text()).toBe(action === 'fold' ? 'Folding…' : 'Unfolding…');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.get(`[aria-label="${label}"]`).attributes('disabled')).toBeDefined();
        release();
        await flushPromises();
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        expect(mobileSimulatorView.mock.calls.filter(([, request]) => request.action === 'start')).toHaveLength(starts + 1);
        expect(wrapper.get('img').attributes('src')).toBe('blob:native-frame');
      }
      mobileSimulator.mockRejectedValueOnce(new Error('Display did not settle.'));
      await wrapper.get('[aria-label="Fold"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      expect(wrapper.get('[role="alert"]').text()).toContain('Display did not settle.');
      expect(wrapper.get('[aria-label="Fold"]').attributes('disabled')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });
  it('uses live video for Android, routes typing and detaches without screenshot polling', async () => {
    const { wrapper, mobileSimulator, mobileSimulatorView } = setup();
    await flushPromises();
    const image = wrapper.get('img');
    expect(image.attributes('src')).toBe('blob:native-frame');
    expect(mobileSimulatorView).toHaveBeenCalledWith('a', { action: 'start', attachmentId: 'session' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(mobileSimulator.mock.calls.some(([, input]) => input.action === 'screenshot')).toBe(false);
    expect(wrapper.find('[aria-label="Back"]').exists()).toBe(true);
    expect(wrapper.find('input[type="text"]').exists()).toBe(false);
    mobileSimulator.mockClear();
    await image.trigger('keydown', { key: 'h' });
    await image.trigger('keydown', { key: 'i' });
    await image.trigger('keydown', { key: 'Enter' });
    await image.trigger('keydown', { key: '!' });
    await image.trigger('keydown', { key: 'a', metaKey: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(mobileSimulator.mock.calls.map(([, input]) => input)).toEqual([
      { action: 'text', attachmentId: 'session', text: 'hi' },
      { action: 'button', attachmentId: 'session', button: 'enter' },
      { action: 'text', attachmentId: 'session', text: '!' },
    ]);
    await wrapper.get('[aria-label="Detach"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('Choose a simulator');
    expect(wrapper.text()).toContain('Pixel');
    wrapper.unmount();
  });

  it('rotates, copies a screenshot to the clipboard and powers the device off from the dock', async () => {
    const { wrapper, mobileSimulator, holdShutdown } = setup();
    await flushPromises();
    const write = vi.fn(async (_items: { items: Record<string, Blob> }[]) => undefined);
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    await wrapper.get('[aria-label="Rotate"]').trigger('click');
    await flushPromises();
    expect(mobileSimulator).toHaveBeenCalledWith('a', { action: 'rotate', attachmentId: 'session' });
    await wrapper.get('[aria-label="Copy screenshot"]').trigger('click');
    await flushPromises();
    expect(write).toHaveBeenCalledOnce();
    const item = write.mock.calls[0]![0][0]!;
    expect(item.items['image/png']!.type).toBe('image/png');
    expect(await item.items['image/png']!.arrayBuffer()).toHaveProperty('byteLength', 3);
    const release = holdShutdown();
    await wrapper.get('[aria-label="Power off"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Powering off');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Rotate"]').exists()).toBe(false);
    release();
    await flushPromises();
    expect(mobileSimulator).toHaveBeenCalledWith('a', { action: 'shutdown', attachmentId: 'session' });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('Choose a simulator');
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  it('falls back to a refreshed device list when the attached device closes outside the app', async () => {
    const { wrapper, mobileSimulator } = setup();
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(true);
    mobileSimulator.mockImplementation((async (_agent: string, input: MobileRequest) => ({
      attachment: null,
      ...(input.action === 'list' ? { catalog: { devices: [{ ...attachment.device, state: 'shutdown' as const }], setup: [] } } : {}),
    })) as never);
    mobileSimulator.mockClear();
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(mobileSimulator.mock.calls.map(([, input]) => input.action)).toContain('list');
    expect(wrapper.text()).toContain('Boot');
    wrapper.unmount();
  });

  it('presses a hardware button on the device frame', async () => {
    const { wrapper, mobileSimulator } = setup();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1500);
    await flushPromises();
    mobileSimulator.mockClear();
    await wrapper.get('[aria-label="Volume up"]').trigger('click');
    await flushPromises();
    expect(mobileSimulator).toHaveBeenCalledWith('a', { action: 'button', attachmentId: 'session', button: 'volumeUp' });
    wrapper.unmount();
  });

  it('stops capture while hidden and discards a late image when switching agents', async () => {
    const { wrapper, mobileSimulator } = setup();
    await flushPromises();
    await wrapper.get('img').trigger('keydown', { key: 'x' });
    await wrapper.setProps({ visible: false });
    mobileSimulator.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mobileSimulator).not.toHaveBeenCalled();
    let finish!: (value: unknown) => void;
    mobileSimulator.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish;
        }),
    );
    await wrapper.setProps({ visible: true });
    await wrapper.setProps({ agentId: 'b', visible: false });
    finish({ attachment, frame });
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(mobileSimulator.mock.calls.some(([, input]) => input.action === 'text')).toBe(false);
    wrapper.unmount();
  });

  it('ignores keys the device cannot type and keeps the live screen when typing is rejected', async () => {
    const { wrapper, mobileSimulator } = setup();
    await flushPromises();
    const image = wrapper.get('img');
    mobileSimulator.mockClear();
    await image.trigger('keydown', { key: 'é' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mobileSimulator.mock.calls.some(([, input]) => input.action === 'text')).toBe(false);
    mobileSimulator.mockRejectedValueOnce(new Error('ADB cannot type a literal %s sequence.'));
    await image.trigger('keydown', { key: 'x' });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('literal %s');
    expect(wrapper.find('img').exists()).toBe(true);
    await image.trigger('keydown', { key: 'y' });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows recoverable errors and removes stale screen content after native failure', async () => {
    const { wrapper, mobileSimulator } = setup();
    await flushPromises();
    mobileSimulator.mockRejectedValueOnce(new Error('Device disconnected'));
    await vi.advanceTimersByTimeAsync(800);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Device disconnected');
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });
  describe('device picker', () => {
    const phone = (
      id: string,
      name: string,
      state: MobileDevice['state'],
      platform: MobileDevice['platform'] = 'ios',
    ): MobileDevice => ({ id, name, platform, state });
    function picker(devices: MobileDevice[], setupItems: { platform: 'ios' | 'android'; message: string; url: string }[] = []) {
      vi.useFakeTimers();
      let attached: { id: string; device: MobileDevice } | null = null;
      const mobileSimulator = vi.fn(async (_agent: string, input: MobileRequest) => {
        if (input.action === 'attach') attached = { id: 'session', device: devices.find((d) => d.id === input.deviceId)! };
        if (input.action === 'detach') attached = null;
        return { attachment: attached, ...(input.action === 'list' ? { catalog: { devices, setup: setupItems } } : {}) };
      });
      setElectronTestClient({ mobileSimulator, mobileSimulatorView: vi.fn(() => new Promise<MobileViewResult>(() => undefined)) });
      return {
        mobileSimulator,
        wrapper: mount(MobileSimulatorPanel, {
          props: { agentId: 'a', visible: true },
          global: { components: { ElSegmented } },
        }),
      };
    }

    it('separates booted from available devices and boots a shut-down one in a single click', async () => {
      const { wrapper, mobileSimulator } = picker([phone('a', 'iPhone Air', 'shutdown'), phone('b', 'iPhone 17', 'booted')]);
      await flushPromises();
      const rows = wrapper.findAll('.mobile-simulator__device');
      expect(wrapper.findAll('.mobile-simulator__group-heading').map((h) => h.text())).toEqual(['Booted', 'Available']);
      expect(rows.map((row) => row.text())).toEqual(['iPhone 17Attach', 'iPhone AirBoot']);
      expect(wrapper.find('.el-segmented').exists()).toBe(false);
      await rows[1]!.trigger('click');
      await flushPromises();
      expect(mobileSimulator).toHaveBeenCalledWith('a', { action: 'attach', deviceId: 'a' });
      expect(wrapper.get('.mobile-simulator__picker-trigger').text()).toBe('iPhone Air');
      wrapper.unmount();
    });

    it('lets the user switch between platforms and shows missing tooling in its own tab', async () => {
      const { wrapper } = picker(
        [phone('a', 'iPhone Air', 'shutdown')],
        [{ platform: 'android', message: 'Install the Android SDK.', url: 'https://example.test/android' }],
      );
      await flushPromises();
      const tabs = wrapper.findAll('.el-segmented__item');
      expect(tabs.map((tab) => tab.text())).toEqual(['iOS', 'Android']);
      expect(wrapper.text()).toContain('iPhone Air');
      expect(wrapper.text()).not.toContain('Install the Android SDK.');
      await tabs[1]!.get('input').setValue(true);
      await flushPromises();
      expect(wrapper.text()).not.toContain('iPhone Air');
      expect(wrapper.text()).toContain('Install the Android SDK.');
      wrapper.unmount();
    });

    it('refreshes when the window regains focus', async () => {
      const { wrapper, mobileSimulator } = picker([], [
        { platform: 'ios', message: 'Install Xcode.', url: 'https://example.test/xcode' },
      ]);
      await flushPromises();
      mobileSimulator.mockClear();
      window.dispatchEvent(new Event('focus'));
      await flushPromises();
      expect(mobileSimulator.mock.calls.filter(([, input]) => input.action === 'list')).toHaveLength(1);
      wrapper.unmount();
    });

    it('explains a failed attach without IPC noise and refreshes the stale device list', async () => {
      const { wrapper, mobileSimulator } = picker([phone('a', 'Pixel_7', 'shutdown', 'android')]);
      await flushPromises();
      mobileSimulator.mockImplementationOnce(async () => {
        throw new Error("Error invoking remote method 'mobile:execute': Error: Device unavailable.");
      });
      mobileSimulator.mockClear();
      await wrapper.get('.mobile-simulator__device').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain('Device unavailable.');
      expect(wrapper.get('[role="alert"]').text()).not.toContain('remote method');
      expect(mobileSimulator.mock.calls.map(([, input]) => input.action)).toContain('list');
      wrapper.unmount();
    });

    it('does not offer devices owned by another agent', async () => {
      const { wrapper } = picker([{ ...phone('a', 'iPhone Air', 'booted'), owner: 'other' }]);
      await flushPromises();
      const row = wrapper.get('.mobile-simulator__device');
      expect(row.text()).toContain('In use');
      expect(row.attributes('disabled')).toBeDefined();
      wrapper.unmount();
    });

    it('switches devices from the toolbar menu by detaching first', async () => {
      const { wrapper, mobileSimulator } = picker([phone('a', 'iPhone Air', 'booted'), phone('b', 'iPhone 17', 'booted')]);
      await flushPromises();
      await wrapper.findAll('.mobile-simulator__device')[0]!.trigger('click');
      await flushPromises();
      await wrapper.get('.mobile-simulator__picker-trigger').trigger('click');
      mobileSimulator.mockClear();
      await wrapper.findAll('[role="menuitemradio"]')[1]!.trigger('click');
      await flushPromises();
      expect(mobileSimulator.mock.calls.map(([, input]) => input.action)).toEqual(['detach', 'attach']);
      expect(wrapper.get('.mobile-simulator__picker-trigger').text()).toBe('iPhone 17');
      wrapper.unmount();
    });

    it('explains an empty machine', async () => {
      const { wrapper } = picker([]);
      await flushPromises();
      expect(wrapper.text()).toContain('No simulators found');
      wrapper.unmount();
    });
  });
});
