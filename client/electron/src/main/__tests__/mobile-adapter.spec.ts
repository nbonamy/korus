import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
const native = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn(), start: vi.fn(), stop: vi.fn() }));
const wire = vi.hoisted(() => ({
  screenshot: vi.fn(),
  describe: vi.fn(),
  tap: vi.fn(),
  swipe: vi.fn(),
  text: vi.fn(),
  button: vi.fn(),
  launch: vi.fn(),
  inspect: vi.fn(),
  close: vi.fn(),
  startVideo: vi.fn(),
  openTouch: vi.fn(),
  setOrientation: vi.fn(),
  getOrientation: vi.fn(),
  setHingeAngle: vi.fn(),
  getHingeAngle: vi.fn(),
}));
vi.mock('../mobile/ios-companion', () => ({
  IosCompanions: class {
    executable = 'idb_companion';
    address() {
      return '/private/bridge.sock';
    }
    start = native.start;
    stop = native.stop;
  },
}));
vi.mock('../mobile/idb-client', () => ({
  IdbClient: class {
    constructor() {
      return wire;
    }
  },
}));
vi.mock('../mobile/commands', () => ({ runMobileCommand: native.run, startMobileProcess: native.spawn }));
import { NativeMobileAdapter } from '../mobile/adapter';
const runtime = {
  companionPath: 'idb_companion',
  protoPath: path.resolve(import.meta.dirname, '../../../resources/mobile-simulator/idb.proto'),
};
const ios = { id: 'ios-device', name: 'iPhone', platform: 'ios' as const, state: 'booted' as const };
const android = { id: 'emulator-5554', name: 'Pixel', platform: 'android' as const, state: 'booted' as const };
const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.writeUInt32BE(1200, 16);
png.writeUInt32BE(2400, 20);
const hostPlatform = process.platform;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.resetAllMocks();
  wire.describe.mockResolvedValue({ udid: ios.id, screen_dimensions: { width: 1200, width_points: 400 } });
  wire.screenshot.mockResolvedValue(png);
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: hostPlatform });
});

describe('native mobile adapters', () => {
  it('waits for the Duo display and refreshes its reported orientation', async () => {
    vi.useFakeTimers();
    const adapter = new NativeMobileAdapter(runtime);
    const duo = { ...ios, foldable: true };
    await adapter.boot(duo);
    wire.getOrientation.mockResolvedValue(1);
    expect(await adapter.displayRotation(duo)).toBe(0);
    wire.getHingeAngle.mockResolvedValueOnce(90).mockResolvedValue(180);
    wire.describe.mockResolvedValue({ udid: ios.id, displays: [{ name: 'LCD-1', integrated: true, active: true }] });
    let settled = false;
    const changing = adapter.setFolded(duo, false).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await changing;
    expect(wire.setHingeAngle).toHaveBeenCalledWith(180);
    wire.getOrientation.mockResolvedValue(4);
    expect(await adapter.displayRotation(duo)).toBe(1);
    wire.getHingeAngle.mockResolvedValue(0);
    wire.describe.mockResolvedValue({ udid: ios.id, displays: [{ name: 'LCD', integrated: true, active: true }] });
    await adapter.setFolded(duo, true);
    wire.getOrientation.mockResolvedValue(2);
    expect(await adapter.displayRotation(duo)).toBe(2);
    await expect(adapter.setFolded(ios, true)).rejects.toThrow('fold');
    adapter.detach(duo);
  });
  it('maps live framebuffer coordinates to device points and releases touch when stopping video', async () => {
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.boot(ios);
    const stop = vi.fn(), send = vi.fn(), close = vi.fn();
    wire.startVideo.mockReturnValue(stop);
    wire.openTouch.mockReturnValue({ send, close });
    const view = await adapter.startView(ios, { png, width: 1200, height: 2400, scale: 3 }, vi.fn(), vi.fn());
    view.touch('down', 301, 601);
    view.touch('move', 301, 301);
    expect(send.mock.calls).toEqual([[100, 200], [100, 100]]);
    view.touch('up', 301, 299);
    expect(close).toHaveBeenCalledOnce();
    view.touch('down', 100, 100);
    view.stop();
    expect(close).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    adapter.detach(ios);
  });
  it('discovers only iOS simulators and online Android emulator serials, with recoverable prerequisite errors', async () => {
    native.run.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'simctl')
        return Buffer.from(
          JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
                { udid: 'ios-device', name: 'iPhone', state: 'Shutdown', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo' },
              ],
              'com.apple.CoreSimulator.SimRuntime.tvOS-27-0': [{ udid: 'tv', name: 'TV', state: 'Booted' }],
            },
          }),
        );
      if (args[0] === 'devices')
        return Buffer.from(
          'List of devices attached\nemulator-5554\tdevice\nphysical\tdevice\nemulator-5556\toffline\n',
        );
      return Buffer.from('');
    });
    const adapter = new NativeMobileAdapter(runtime);
    expect((await adapter.list()).devices).toEqual([
      { ...ios, state: 'shutdown', foldable: true },
      { ...android, name: 'emulator-5554' },
    ]);
    native.run.mockRejectedValueOnce(new Error('Xcode missing')).mockRejectedValueOnce(new Error('adb missing'));
    expect((await adapter.list()).setup.map((item) => item.platform)).toEqual(['ios', 'android']);
    native.run.mockResolvedValueOnce(Buffer.from('{"devices":{}}'));
    expect((await adapter.list()).setup).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Create an iOS Simulator') }),
    );
    const missing = new NativeMobileAdapter({ ...runtime, protoPath: '/missing/protocol' });
    expect((await missing.list()).setup).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('bundled iOS bridge') }),
    );
  });

  it('lists Android virtual devices, marking running ones booted under their AVD name', async () => {
    native.run.mockImplementation(async (file: string, args: string[]) => {
      if (args[0] === 'simctl') return Buffer.from('{"devices":{}}');
      if (args[0] === 'devices') return Buffer.from('List of devices attached\nemulator-5554\tdevice\n');
      if (args.includes('emu')) return Buffer.from('Pixel_9\nOK\n');
      if (args[0] === '-list-avds') return Buffer.from('INFO    | Storing crashdata\nPixel_9\nTablet_API_35\n');
      return Buffer.from('');
    });
    const devices = (await new NativeMobileAdapter(runtime).list()).devices.filter((device) => device.platform === 'android');
    expect(devices).toEqual([
      { id: 'emulator-5554', name: 'Pixel_9', platform: 'android', state: 'booted' },
      { id: 'avd:Tablet_API_35', name: 'Tablet_API_35', platform: 'android', state: 'shutdown' },
    ]);
  });

  it('starts a shut-down AVD and resolves the serial once Android reports boot completion', async () => {
    vi.useFakeTimers();
    let polls = 0;
    native.run.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'devices') return Buffer.from(polls++ ? 'emulator-5556\tdevice\n' : '');
      if (args.includes('emu')) return Buffer.from('Tablet_API_35\nOK\n');
      if (args.includes('getprop')) return Buffer.from(polls > 2 ? '1\n' : '');
      return Buffer.from('');
    });
    const adapter = new NativeMobileAdapter(runtime);
    const booting = adapter.boot({ id: 'avd:Tablet_API_35', name: 'Tablet_API_35', platform: 'android', state: 'shutdown' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await booting).toEqual({ id: 'emulator-5556', name: 'Tablet_API_35', platform: 'android', state: 'booted' });
    expect(native.spawn).toHaveBeenCalledWith(expect.stringContaining('emulator'), ['-avd', 'Tablet_API_35']);
    vi.useRealTimers();
  });

  it('gives up with a recoverable error when an AVD never finishes booting', async () => {
    vi.useFakeTimers();
    native.run.mockResolvedValue(Buffer.from(''));
    const booting = new NativeMobileAdapter(runtime).boot({ id: 'avd:Pixel', name: 'Pixel', platform: 'android', state: 'shutdown' });
    const rejected = expect(booting).rejects.toThrow('did not finish starting');
    await vi.advanceTimersByTimeAsync(200_000);
    await rejected;
    vi.useRealTimers();
  });

  it('cycles iOS orientation from the device state and reports how to display the portrait framebuffer', async () => {
    wire.getOrientation.mockResolvedValue(1);
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.boot(ios);
    expect(await adapter.displayRotation(ios)).toBe(0);
    const turns: number[] = [];
    for (let index = 0; index < 4; index++) {
      await adapter.rotate(ios);
      turns.push(await adapter.displayRotation(ios));
    }
    expect(wire.setOrientation.mock.calls.map(([value]) => value)).toEqual([3, 1, 2, 0]);
    expect(turns).toEqual([1, 2, 3, 0]);
    expect(await adapter.displayRotation(android)).toBe(0);
  });

  it('continues from an iOS device that was already rotated outside the app', async () => {
    wire.getOrientation.mockResolvedValue(4); // landscape right
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.boot(ios);
    expect(await adapter.displayRotation(ios)).toBe(1);
    await adapter.rotate(ios);
    expect(wire.setOrientation).toHaveBeenCalledWith(1);
  });

  it('knows when a simulator or emulator was closed outside the app', async () => {
    native.run.mockResolvedValue(Buffer.from('List of devices attached\nemulator-5554\tdevice\n'));
    const adapter = new NativeMobileAdapter(runtime);
    expect(await adapter.isRunning(android)).toBe(true);
    native.run.mockResolvedValue(Buffer.from('List of devices attached\n'));
    expect(await adapter.isRunning(android)).toBe(false);
    native.run.mockRejectedValue(new Error('adb failed'));
    expect(await adapter.isRunning(android)).toBe(true); // adb itself failing proves nothing about the device
    expect(await adapter.isRunning(ios)).toBe(true); // mocked companion still answers
  });

  it('rotates Android through the user rotation setting and powers devices off', async () => {
    native.run.mockImplementation(async (_file: string, args: string[]) => Buffer.from(args.includes('get') ? '3\n' : ''));
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.rotate(android);
    expect(native.run).toHaveBeenCalledWith(expect.any(String), ['-s', android.id, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
    expect(native.run).toHaveBeenCalledWith(expect.any(String), ['-s', android.id, 'shell', 'settings', 'put', 'system', 'user_rotation', '0']);
    await adapter.shutdown(android);
    expect(native.run).toHaveBeenLastCalledWith(expect.any(String), ['-s', android.id, 'emu', 'kill']);
    await adapter.shutdown(ios);
    expect(native.run).toHaveBeenLastCalledWith('/usr/bin/xcrun', ['simctl', 'shutdown', ios.id]);
  });

  it('boots the selected iOS device, verifies companion identity, and closes only its connection on detach', async () => {
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.boot({ ...ios, state: 'shutdown' });
    expect(native.run).toHaveBeenCalledWith('/usr/bin/xcrun', ['simctl', 'bootstatus', ios.id, '-b'], 90_000);
    expect(native.start).toHaveBeenCalledWith(ios.id);
    adapter.detach(ios);
    expect(wire.close).toHaveBeenCalledOnce();
    expect(native.stop).toHaveBeenCalledWith(ios.id);
    await expect(adapter.screen(ios)).rejects.toThrow('disconnected');
    wire.describe.mockResolvedValueOnce({ udid: 'different-device' });
    await expect(adapter.boot(ios)).rejects.toThrow('different device');
    expect(wire.close).toHaveBeenCalledTimes(2);
  });

  it('maps screenshot pixels including edges into iOS points and swipe seconds', async () => {
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.boot(ios);
    const screen = await adapter.screen(ios);
    expect(screen).toEqual({ png, width: 1200, height: 2400, scale: 3 });
    await adapter.perform(ios, { action: 'tap', x: 1199, y: 2399, width: 1200, height: 2400 }, screen);
    expect(wire.tap).toHaveBeenCalledWith(399, 799);
    await adapter.perform(
      ios,
      { action: 'swipe', x: 300, y: 600, toX: 600, toY: 900, width: 1200, height: 2400, durationMs: 500 },
      screen,
    );
    expect(wire.swipe).toHaveBeenCalledWith(100, 200, 200, 300, 0.5);
    await adapter.perform(ios, { action: 'text', text: 'Hi' });
    expect(wire.text).toHaveBeenCalledWith('Hi');
    await adapter.perform(ios, { action: 'button', button: 'home' });
    expect(wire.button).toHaveBeenCalledWith('home');
    await adapter.perform(ios, { action: 'launch', appId: 'com.example.app' });
    expect(wire.launch).toHaveBeenCalledWith('com.example.app');
    wire.inspect.mockResolvedValue('accessibility');
    expect(await adapter.inspect(ios)).toBe('accessibility');
  });

  it('rejects invalid images and missing iOS scale rather than guessing', async () => {
    const adapter = new NativeMobileAdapter(runtime);
    native.run.mockResolvedValueOnce(Buffer.from('bad'));
    await expect(adapter.screen(android)).rejects.toThrow('invalid screenshot');
    await adapter.boot(ios);
    wire.describe.mockResolvedValueOnce({});
    await expect(adapter.screen(ios)).rejects.toThrow('screen scale');
    const invalid = Buffer.from(png);
    invalid.writeUInt32BE(10001, 16);
    native.run.mockResolvedValueOnce(invalid);
    await expect(adapter.screen(android)).rejects.toThrow('dimensions');
  });

  it('quotes Android text at the guest shell boundary and rejects unsupported text', async () => {
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.perform(android, { action: 'text', text: "hello ';$(touch /x)" });
    expect(native.run).toHaveBeenLastCalledWith(expect.any(String), [
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'text',
      "'hello%s'\\'';$(touch%s/x)'",
    ]);
    await expect(adapter.perform(android, { action: 'text', text: 'é' })).rejects.toThrow('ASCII');
    await expect(adapter.perform(android, { action: 'text', text: '%s' })).rejects.toThrow('literal %s');
  });

  it('uses Android pixels and milliseconds, launches packages, and rejects unsuccessful launch/inspection', async () => {
    native.run.mockResolvedValue(Buffer.from('<hierarchy rotation="0"></hierarchy>'));
    const adapter = new NativeMobileAdapter(runtime);
    await adapter.perform(android, {
      action: 'swipe',
      x: 300,
      y: 600,
      toX: 600,
      toY: 900,
      width: 1200,
      height: 2400,
      durationMs: 500,
    });
    expect(native.run.mock.lastCall?.[1]).toEqual([
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'swipe',
      '300',
      '600',
      '600',
      '900',
      '500',
    ]);
    await adapter.perform(android, { action: 'tap', x: 300, y: 600, width: 1200, height: 2400 });
    expect(native.run.mock.lastCall?.[1]).toEqual(['-s', 'emulator-5554', 'shell', 'input', 'tap', '300', '600']);
    await adapter.perform(android, { action: 'button', button: 'back' });
    expect(native.run.mock.lastCall?.[1]).toEqual(['-s', 'emulator-5554', 'shell', 'input', 'keyevent', '4']);
    for (const [button, code] of [['volumeUp', '24'], ['volumeDown', '25'], ['power', '26']] as const) {
      await adapter.perform(android, { action: 'button', button });
      expect(native.run.mock.lastCall?.[1]).toEqual(['-s', 'emulator-5554', 'shell', 'input', 'keyevent', code]);
    }
    native.run.mockResolvedValueOnce(Buffer.from('Events injected: 1'));
    await adapter.perform(android, { action: 'launch', appId: 'com.test.app' });
    expect(native.run.mock.lastCall?.[1]).toEqual([
      '-s',
      'emulator-5554',
      'shell',
      'monkey',
      '-p',
      'com.test.app',
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
    native.run.mockResolvedValueOnce(Buffer.from('No activities found'));
    await expect(adapter.perform(android, { action: 'launch', appId: 'com.missing.app' })).rejects.toThrow(
      'could not launch',
    );
    expect(await adapter.inspect(android)).toContain('<hierarchy');
    native.run.mockResolvedValueOnce(Buffer.from('ERROR: could not dump'));
    await expect(adapter.inspect(android)).rejects.toThrow('unavailable');
  });
});
