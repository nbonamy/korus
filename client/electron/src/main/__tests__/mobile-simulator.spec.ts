import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileSimulatorService } from '../mobile/service';
import type { MobileAdapter, DeviceFrameListener, DeviceView } from '../mobile/adapter';

function fixture() {
  const adapter: MobileAdapter = {
    list: vi.fn(async () => ({
      devices: [{ id: 'phone', name: 'iPhone', platform: 'ios' as const, state: 'shutdown' as const }],
      setup: [],
    })),
    detach: vi.fn(),
    boot: vi.fn(async () => undefined),
    screen: vi.fn(async () => ({ png: Buffer.from('real-image'), width: 1200, height: 2400, scale: 3 })),
    perform: vi.fn(async () => undefined),
    inspect: vi.fn(async () => 'Settings'),
    rotate: vi.fn(async () => undefined),
    setFolded: vi.fn(async () => undefined),
    displayRotation: vi.fn(async () => 0 as const),
    isRunning: vi.fn(async () => true),
    shutdown: vi.fn(async () => undefined),
  };
  return { adapter, service: new MobileSimulatorService(adapter) };
}
afterEach(() => vi.useRealTimers());

describe('mobile simulator attachment', () => {
  it('changes the hinge only for the desktop owner and closes stale video before changing displays', async () => {
    const { service, adapter } = fixture();
    vi.mocked(adapter.list).mockResolvedValue({ devices: [{ id: 'duo', name: 'My phone', platform: 'ios', state: 'booted', foldable: true }], setup: [] });
    const stop = vi.fn();
    adapter.startView = vi.fn(() => ({ touch: vi.fn(), stop }));
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'duo' }, true);
    const target = { attachmentId: attachment!.id };
    try {
      await service.view('a', { action: 'start', ...target });
      await expect(service.execute('a', { action: 'fold', ...target })).rejects.toThrow('desktop user');
      await expect(service.execute('b', { action: 'fold', ...target }, true)).rejects.toThrow('No matching');
      expect(adapter.setFolded).not.toHaveBeenCalled();
      await service.execute('a', { action: 'fold', ...target }, true);
      expect(stop).toHaveBeenCalledOnce();
      expect(adapter.setFolded).toHaveBeenLastCalledWith(attachment!.device, true);
      await service.execute('a', { action: 'unfold', ...target }, true);
      expect(adapter.setFolded).toHaveBeenLastCalledWith(attachment!.device, false);
    } finally { service.clear(); }
  });
  it('keeps an idle native video view open without repeating a frame or dropping pending touch ordering', async () => {
    vi.useFakeTimers();
    const { service, adapter } = fixture();
    let frame!: DeviceFrameListener;
    let complete!: () => void;
    const touch = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    adapter.startView = vi.fn(async (_device, _screen, onFrame) => { frame = onFrame; return { touch, stop: vi.fn() }; });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId: attachment!.id });
      const target = { attachmentId: attachment!.id, viewId };
      frame(Buffer.from('native-png'), 'image/png');
      expect((await service.view('a', { ...target, action: 'frame' })).frame?.mimeType).toBe('image/png');
      const idle = service.view('a', { ...target, action: 'frame' });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await idle).toStrictEqual({ viewId });
      const pending = service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'down', x: 300, y: 600 });
      await expect(service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'move', x: 300, y: 500 })).rejects.toThrow('pending');
      complete(); await pending;
      expect(touch).toHaveBeenCalledOnce();
    } finally { service.clear(); }
  });
  it('rejects coordinates from an older orientation and releases a held gesture if the display changes', async () => {
    const { service, adapter } = fixture(); let frame!: DeviceFrameListener;
    const device = { touch: vi.fn(), stop: vi.fn() };
    adapter.startView = vi.fn((_device, _screen, onFrame) => { frame = onFrame; return device; });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId: attachment!.id });
      const target = { attachmentId: attachment!.id, viewId };
      frame(Buffer.from('landscape'), 'image/png', {width:2400,height:1200,rotation:1});
      const { frame: observed } = await service.view('a', { ...target, action:'frame' });
      expect(observed).toMatchObject({width:2400,height:1200,geometry:1});
      await expect(service.view('a', {...target, action:'touch', phase:'down',x:200,y:300,geometry:0})).rejects.toThrow('Display changed');
      expect(device.touch).not.toHaveBeenCalled();
      await service.view('a', {...target,action:'touch',phase:'down',x:200,y:300,geometry:observed!.geometry});
      frame(Buffer.from('rotated'), 'image/png', {width:2400,height:1200,rotation:3});
      expect(device.stop).toHaveBeenCalledOnce();
      await expect(service.view('a', {...target,action:'frame'})).rejects.toThrow('Display changed during touch');
    } finally { service.clear(); }
  });
  it('releases a bridge that finishes connecting after the attachment was revoked', async () => {
    const { service, adapter } = fixture(); let finish!: (view: DeviceView) => void;
    adapter.startView = vi.fn(() => new Promise<DeviceView>(resolve => { finish = resolve; }));
    const { attachment } = await service.execute('a', { action:'attach',deviceId:'phone' });
    const pending = service.view('a', {action:'start',attachmentId:attachment!.id});
    await vi.waitFor(() => expect(adapter.startView).toHaveBeenCalled());
    service.clear(); const stop = vi.fn(); finish({touch:vi.fn(),stop});
    await expect(pending).resolves.toMatchObject({ ended: true }); expect(stop).toHaveBeenCalledOnce();
  });
  it('attaches a virtual device that started after the pane listed it', async () => {
    const { service, adapter } = fixture();
    const running = { id: 'emulator-5554', name: 'Pixel', platform: 'android' as const, state: 'booted' as const };
    vi.mocked(adapter.list).mockResolvedValue({ devices: [running], setup: [] });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'avd:Pixel' }, true);
    expect(attachment!.device).toEqual(running);
    service.clear();
  });

  it('releases the attachment and its video when the device is closed outside the app', async () => {
    vi.useFakeTimers();
    const { service, adapter } = fixture();
    const stop = vi.fn();
    adapter.startView = vi.fn(() => ({ touch: vi.fn(), stop }));
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    await service.view('a', { action: 'start', attachmentId: attachment!.id });
    // Checks are throttled: the pane polls status far more often than a device can disappear.
    vi.mocked(adapter.isRunning).mockClear();
    for (let poll = 0; poll < 3; poll++) await service.execute('a', { action: 'status' });
    expect(adapter.isRunning).toHaveBeenCalledTimes(1);
    vi.mocked(adapter.isRunning).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await service.execute('a', { action: 'status' })).toStrictEqual({ attachment: null });
    expect(stop).toHaveBeenCalledOnce();
    expect(adapter.detach).toHaveBeenCalledWith(attachment!.device);
    expect((await service.execute('a', { action: 'list' })).attachment).toBeNull();
    service.clear();
  });

  it('accepts the hardware buttons and rejects unknown ones', async () => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    const attachmentId = attachment!.id;
    for (const button of ['volumeUp', 'volumeDown', 'power'] as const)
      await service.execute('a', { action: 'button', button, attachmentId });
    expect(vi.mocked(adapter.perform).mock.calls.map(([, input]) => (input as { button: string }).button)).toEqual([
      'volumeUp', 'volumeDown', 'power',
    ]);
    await expect(
      service.execute('a', { action: 'button', button: 'eject' as never, attachmentId }),
    ).rejects.toThrow('Unsupported device button');
    service.clear();
  });

  it('rotates only for the desktop user while the owner may power off its attachment', async () => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' }, true);
    const attachmentId = attachment!.id;
    await expect(service.execute('a', { action: 'rotate', attachmentId })).rejects.toThrow('desktop user');
    expect(adapter.rotate).not.toHaveBeenCalled();
    await service.execute('a', { action: 'rotate', attachmentId }, true);
    expect(adapter.rotate).toHaveBeenCalledWith(attachment!.device);
    await expect(service.execute('b', { action: 'shutdown', attachmentId })).rejects.toThrow('No matching');
    expect(adapter.shutdown).not.toHaveBeenCalled();
    expect(await service.execute('a', { action: 'shutdown', attachmentId })).toEqual({ attachment: null });
    expect(adapter.detach).toHaveBeenCalledWith(attachment!.device);
    expect(adapter.shutdown).toHaveBeenCalledWith(attachment!.device);
    await expect(service.execute('a', { action: 'rotate', attachmentId }, true)).rejects.toThrow('No matching');
    service.clear();
  });

  it('tells the live view how to display a rotated iOS framebuffer', async () => {
    const { service, adapter } = fixture();
    let frame!: (jpeg: Buffer) => void;
    adapter.startView = vi.fn((_device, _screen, onFrame) => { frame = onFrame; return { touch: vi.fn(), stop: vi.fn() }; });
    vi.mocked(adapter.displayRotation).mockResolvedValue(3);
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' }, true);
    const target = { attachmentId: attachment!.id };
    const { viewId } = await service.view('a', { ...target, action: 'start' });
    frame(Buffer.from('landscape'));
    expect((await service.view('a', { ...target, viewId, action: 'frame' })).frame!.rotation).toBe(3);
    vi.mocked(adapter.displayRotation).mockResolvedValue(1);
    await service.execute('a', { action: 'rotate', ...target }, true);
    frame(Buffer.from('turned'));
    expect((await service.view('a', { ...target, viewId, action: 'frame' })).frame!.rotation).toBe(1);
    // A turned device is touched in upright landscape coordinates, wider than the portrait framebuffer.
    await service.view('a', { ...target, viewId, action: 'touch', geometry: 0, phase: 'down', x: 2300, y: 1100 });
    await expect(
      service.view('a', { ...target, viewId, action: 'touch', geometry: 0, phase: 'move', x: 2300, y: 1300 }),
    ).rejects.toThrow('Invalid live touch');
    service.clear();
  });

  it('attaches to the device identity returned by boot, not the listed placeholder', async () => {
    const { service, adapter } = fixture();
    const started = { id: 'emulator-5554', name: 'Pixel', platform: 'android' as const, state: 'booted' as const };
    vi.mocked(adapter.list).mockResolvedValue({
      devices: [{ ...started, id: 'avd:Pixel', state: 'shutdown' }],
      setup: [],
    });
    vi.mocked(adapter.boot).mockResolvedValue(started);
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'avd:Pixel' });
    expect(attachment!.device).toEqual(started);
    expect(adapter.screen).toHaveBeenCalledWith(started);
    service.clear();
  });

  it('streams only to the attachment owner, drops old frames, and delivers touch without taking screenshots', async () => {
    const { service, adapter } = fixture();
    let frame!: (jpeg: Buffer) => void;
    const device = { touch: vi.fn(), stop: vi.fn() };
    adapter.startView = vi.fn((_device, _screen, onFrame) => { frame = onFrame; return device; });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    const attachmentId = attachment!.id;
    try {
      await expect(service.view('b', { action: 'start', attachmentId })).rejects.toThrow('attachment');
      const { viewId } = await service.view('a', { action: 'start', attachmentId });
      const target = { attachmentId, viewId };
      await expect(service.view('b', { ...target, action: 'frame' })).rejects.toThrow('attachment');
      frame(Buffer.from('old')); frame(Buffer.from('new'));
      expect(await service.view('a', { ...target, action: 'frame' })).toStrictEqual({ viewId, frame: { mimeType: 'image/jpeg', geometry: 0, rotation: 0, data: new Uint8Array(Buffer.from('new')), width: 1200, height: 2400 } });
      vi.mocked(adapter.screen).mockClear();
      await service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'down', x: 300, y: 900 });
      await service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'move', x: 300, y: 600 });
      expect(device.touch.mock.calls).toEqual([['down', 300, 900], ['move', 300, 600]]);
      expect(adapter.screen).not.toHaveBeenCalled();
      await expect(service.execute('a', { action: 'button', button: 'home', attachmentId })).rejects.toThrow('touch');
      const pending = service.view('a', { ...target, action: 'frame' });
      const ended = expect(pending).resolves.toStrictEqual({ viewId, ended: true });
      await service.execute('a', { action: 'detach', attachmentId });
      await ended;
      expect(device.stop).toHaveBeenCalledOnce();
      frame(Buffer.from('late'));
      await expect(service.view('a', { ...target, action: 'frame' })).rejects.toThrow('attachment');
      await expect(service.view('a', { ...target, action: 'stop' })).resolves.toStrictEqual({ viewId, ended: true });
    } finally { service.clear(); }
  });

  it('expires abandoned video, rejects duplicate reads and invalid touch, and allows reconnect after failure', async () => {
    vi.useFakeTimers();
    const { service, adapter } = fixture();
    const stop = vi.fn();
    adapter.startView = vi.fn(() => ({ touch: vi.fn(), stop }));
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    const attachmentId = attachment!.id;
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId });
      const target = { attachmentId, viewId };
      await expect(service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'move', x: 20, y: 30 })).rejects.toThrow('sequence');
      await expect(service.view('a', { ...target, action: 'touch', geometry: 0, phase: 'down', x: 1200, y: 30 })).rejects.toThrow('coordinates');
      const pending = service.view('a', { ...target, action: 'frame' });
      const timedOut = expect(pending).rejects.toThrow('timed out');
      await expect(service.view('a', { ...target, action: 'frame' })).rejects.toThrow('pending');
      await vi.advanceTimersByTimeAsync(10_000);
      await timedOut;
      expect(stop).toHaveBeenCalledOnce();
      const replacement = await service.view('a', { action: 'start', attachmentId });
      await expect(service.view('a', { ...target, action: 'stop' })).resolves.toStrictEqual({ viewId, ended: true });
      expect(stop).toHaveBeenCalledOnce(); // Stale cleanup must not stop the replacement.
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(service.view('a', { action: 'frame', attachmentId, viewId: replacement.viewId })).rejects.toThrow('expired');
      expect(stop).toHaveBeenCalledTimes(2);
    } finally { service.clear(); }
  });

  it.each(['screen', 'rotation'] as const)('discards a view removed during its %s read', async (step) => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    let reached!: () => void;
    const boundary = new Promise<void>(resolve => { reached = resolve; });
    let finish!: () => void;
    if (step === 'screen') {
      vi.mocked(adapter.screen).mockImplementationOnce(() => {
        reached();
        return new Promise(resolve => { finish = () => resolve({ png: Buffer.from('x'), width: 1200, height: 2400, scale: 3 }); });
      });
    } else {
      vi.mocked(adapter.displayRotation).mockImplementationOnce(() => {
        reached();
        return new Promise(resolve => { finish = () => resolve(0); });
      });
    }
    adapter.startView = vi.fn();
    const pending = service.view('a', { action: 'start', attachmentId: attachment!.id });
    try {
      await boundary;
      service.retainAgents([]);
      finish();
      await expect(pending).resolves.toMatchObject({ ended: true });
      expect(adapter.startView).not.toHaveBeenCalled();
    } finally { service.clear(); }
  });

  it('keeps native video failures observable instead of treating them as normal closure', async () => {
    const { service, adapter } = fixture();
    let fail!: (error: Error) => void;
    const stop = vi.fn();
    adapter.startView = vi.fn((_device, _screen, _frame, onError) => {
      fail = onError;
      return { touch: vi.fn(), stop };
    });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId: attachment!.id });
      const target = { attachmentId: attachment!.id, viewId };
      const failure = new Error('Native video bridge failed');
      const pending = service.view('a', { ...target, action: 'frame' });
      const rejected = expect(pending).rejects.toBe(failure);
      fail(failure);
      await rejected;
      await expect(service.view('a', { ...target, action: 'frame' })).rejects.toBe(failure);
      await service.view('a', { ...target, action: 'stop' });
      expect(stop).toHaveBeenCalledOnce();
    } finally { service.clear(); }
  });

  it.each(['shutdown', 'clear'] as const)('settles a pending video read and repeated cleanup during %s', async (action) => {
    const { service, adapter } = fixture();
    const stop = vi.fn();
    adapter.startView = vi.fn(() => ({ touch: vi.fn(), stop }));
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId: attachment!.id });
      const target = { attachmentId: attachment!.id, viewId };
      const pending = service.view('a', { ...target, action: 'frame' });
      const ended = expect(pending).resolves.toStrictEqual({ viewId, ended: true });
      if (action === 'clear') service.clear();
      else await service.execute('a', { action, attachmentId: attachment!.id });
      await ended;
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(service.view('a', { ...target, action: 'stop' })).resolves.toStrictEqual({ viewId, ended: true });
      }
      expect(stop).toHaveBeenCalledOnce();
      expect(await service.execute('a', { action: 'status' })).toStrictEqual({ attachment: null });
    } finally { service.clear(); }
  });

  it('does not let cleanup for another agent or attachment close an active view', async () => {
    const { service, adapter } = fixture();
    let frame!: DeviceFrameListener;
    const stop = vi.fn();
    adapter.startView = vi.fn((_device, _screen, onFrame) => { frame = onFrame; return { touch: vi.fn(), stop }; });
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    try {
      const { viewId } = await service.view('a', { action: 'start', attachmentId: attachment!.id });
      const target = { attachmentId: attachment!.id, viewId };
      await service.view('b', { ...target, action: 'stop' });
      await service.view('a', { ...target, attachmentId: 'wrong-attachment', action: 'stop' });
      frame(Buffer.from('still-live'));
      expect((await service.view('a', { ...target, action: 'frame' })).frame?.data).toStrictEqual(new Uint8Array(Buffer.from('still-live')));
      expect(stop).not.toHaveBeenCalled();
    } finally { service.clear(); }
  });
  it('grants one owner, refuses competing agents, and releases without stopping the device', async () => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    expect(adapter.boot).toHaveBeenCalledOnce();
    await expect(service.execute('b', { action: 'attach', deviceId: 'phone' })).rejects.toThrow('another agent');
    await expect(service.execute('b', { action: 'screenshot', attachmentId: attachment!.id })).rejects.toThrow(
      'No matching',
    );
    expect((await service.execute('a', { action: 'list' })).catalog?.devices[0]?.owner).toBe('a');
    await service.execute('a', { action: 'detach', attachmentId: attachment!.id });
    expect(adapter.detach).toHaveBeenCalledWith(attachment!.device);
    expect((await service.execute('b', { action: 'attach', deviceId: 'phone' })).attachment?.device.id).toBe('phone');
    await expect(service.execute('a', { action: 'screenshot', attachmentId: attachment!.id })).rejects.toThrow(
      'No matching',
    );
  });

  it('returns actual image bytes and rejects stale orientation and out-of-bounds input before delivering it', async () => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    const attachmentId = attachment!.id;
    expect((await service.execute('a', { action: 'screenshot', attachmentId })).frame).toStrictEqual({
      attachmentId,
      data: Buffer.from('real-image').toString('base64'),
      mimeType: 'image/png',
      scale: 3,
      width: 1200,
      height: 2400,
    });
    await expect(
      service.execute('a', { action: 'tap', attachmentId, x: 1200, y: 1, width: 1200, height: 2400 }),
    ).rejects.toThrow('coordinates');
    await expect(
      service.execute('a', { action: 'tap', attachmentId, x: 10, y: 10, width: 2400, height: 1200 }),
    ).rejects.toThrow('dimensions changed');
    expect(adapter.perform).not.toHaveBeenCalled();
    await service.execute('a', { action: 'tap', attachmentId, x: 300, y: 600, width: 1200, height: 2400 });
    expect(adapter.perform).toHaveBeenCalledWith(
      attachment!.device,
      expect.objectContaining({ x: 300, y: 600 }),
      expect.objectContaining({ scale: 3 }),
    );
  });

  it('keeps bridge failure recoverable without granting an attachment', async () => {
    const { service, adapter } = fixture();
    vi.mocked(adapter.screen).mockRejectedValueOnce(new Error('helper failed'));
    await expect(service.execute('a', { action: 'attach', deviceId: 'phone' })).rejects.toThrow('helper failed');
    expect(await service.execute('a', { action: 'status' })).toStrictEqual({ attachment: null });
    expect((await service.execute('a', { action: 'attach', deviceId: 'phone' })).attachment).not.toBeNull();
  });

  it('invalidates an in-flight boot and queued work on disconnect', async () => {
    const { service, adapter } = fixture();
    let booted!: () => void;
    vi.mocked(adapter.boot).mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          booted = () => resolve(undefined);
        }),
    );
    const pending = service.execute('a', { action: 'attach', deviceId: 'phone' });
    await vi.waitFor(() => expect(adapter.boot).toHaveBeenCalled());
    const queued = service.execute('b', { action: 'attach', deviceId: 'phone' });
    service.clear();
    booted();
    await expect(pending).rejects.toThrow('session ended');
    await expect(queued).rejects.toThrow('session ended');
    expect(await service.execute('a', { action: 'status' })).toStrictEqual({ attachment: null });
  });

  it('labels unavailable accessibility as screenshot fallback and removes closed agent ownership', async () => {
    const { service, adapter } = fixture();
    const { attachment } = await service.execute('a', { action: 'attach', deviceId: 'phone' });
    vi.mocked(adapter.inspect).mockRejectedValueOnce(new Error('no AX'));
    expect((await service.execute('a', { action: 'inspect', attachmentId: attachment!.id })).inspection?.kind).toBe(
      'screenshot',
    );
    service.retainAgents([]);
    await expect(service.execute('a', { action: 'status' })).rejects.toThrow('no longer available');
    service.retainAgents(['b']);
    expect((await service.execute('b', { action: 'attach', deviceId: 'phone' })).attachment?.device.id).toBe('phone');
  });
});
