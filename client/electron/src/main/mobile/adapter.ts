import { product } from '@workspace/core/product';
import { IdbClient } from './idb-client';
import { AndroidLiveView } from './android-live-view';
import type { MobileRuntimePaths } from './runtime';
import { IosCompanions } from './ios-companion';
import type { MobileAction, MobileCatalog, MobileDevice } from '@workspace/core/mobile-simulator';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMobileCommand, startMobileProcess } from './commands';

export type DeviceScreen = { png: Buffer; width: number; height: number; scale: number };
export type DeviceFrameListener = (image: Buffer, mimeType?: 'image/jpeg' | 'image/png', geometry?: { width: number; height: number; rotation: number }) => void;
export type DeviceView = { touch(phase: 'down' | 'move' | 'up', x: number, y: number): void | Promise<void>; stop(): void };
export interface MobileAdapter {
  list(): Promise<MobileCatalog>;
  /** Resolves the device the session must use when starting it changes its identity (Android serial). */
  boot(device: MobileDevice): Promise<MobileDevice | void>;
  detach(device: MobileDevice): void;
  screen(device: MobileDevice): Promise<DeviceScreen>;
  perform(device: MobileDevice, action: MobileAction, screen?: DeviceScreen): Promise<void>;
  inspect(device: MobileDevice): Promise<string>;
  rotate(device: MobileDevice): Promise<void>;
  setFolded(device: MobileDevice, folded: boolean): Promise<void>;
  /** False once the device has been closed or powered off outside the app. */
  isRunning(device: MobileDevice): Promise<boolean>;
  /** Clockwise quarter turns that show the device's framebuffer upright. */
  displayRotation(device: MobileDevice): Promise<0 | 1 | 2 | 3>;
  /** Powers the device off; the caller has already detached it. */
  shutdown(device: MobileDevice): Promise<void>;
  startView?(device: MobileDevice, screen: DeviceScreen, onFrame: DeviceFrameListener, onError: (error: Error) => void): DeviceView | Promise<DeviceView>;
}

export class NativeMobileAdapter implements MobileAdapter {
  private readonly companions: IosCompanions;
  private readonly clients = new Map<string, IdbClient>();
  private readonly orientations = new Map<string, 0 | 1 | 2 | 3>();
  constructor(private readonly runtime: MobileRuntimePaths) {
    this.companions = new IosCompanions(runtime.companionPath);
  }
  private readonly adb = executable(
    process.platform === 'win32' ? 'adb.exe' : 'adb',
    androidRoots().map((root) => path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')),
  );
  private readonly emulator = executable(
    process.platform === 'win32' ? 'emulator.exe' : 'emulator',
    androidRoots().map((root) => path.join(root, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator')),
  );

  async list(): Promise<MobileCatalog> {
    const catalog: MobileCatalog = { devices: [], setup: [] };
    if (process.platform === 'darwin') {
      try {
        const result = JSON.parse(
          (await runMobileCommand('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).toString(),
        );
        const bridge =
          existsSync(this.runtime.protoPath) &&
          (await runMobileCommand(this.companions.executable, ['--version']).then(
            () => true,
            () => false,
          ));
        if (!bridge)
          catalog.setup.push({
            platform: 'ios',
            message: `The bundled iOS bridge is unavailable. Update or reinstall ${product.name}, and check macOS/Xcode compatibility.`,
            url: product.websiteUrl,
          });
        else
          for (const [runtime, devices] of Object.entries(
            result.devices as Record<string, { udid: string; name: string; state: string; deviceTypeIdentifier?: string }[]>,
          )) {
            if (!runtime.includes('.iOS-')) continue;
            for (const device of devices)
              catalog.devices.push({
                id: device.udid,
                name: device.name,
                platform: 'ios',
                state: device.state === 'Booted' ? 'booted' : 'shutdown',
                ...(device.deviceTypeIdentifier === 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo' ? { foldable: true } : {}),
              });
          }
        if (bridge && !catalog.devices.some((device) => device.platform === 'ios'))
          catalog.setup.push({
            platform: 'ios',
            message: 'Create an iOS Simulator in Xcode and install its runtime.',
            url: 'https://developer.apple.com/documentation/xcode/installing-additional-simulator-runtimes',
          });
      } catch {
        catalog.setup.push({
          platform: 'ios',
          message: 'Install Xcode, select its developer directory, and install an iOS Simulator runtime.',
          url: 'https://developer.apple.com/xcode/',
        });
      }
    }
    try {
      const running = await this.runningEmulators();
      const avds = await runMobileCommand(this.emulator, ['-list-avds']).then(
        (output) => output.toString().split('\n').map((line) => line.trim()).filter((line) => /^[\w.-]+$/.test(line)),
        () => [],
      );
      for (const emulator of running)
        catalog.devices.push({ id: emulator.serial, name: emulator.name, platform: 'android', state: 'booted' });
      for (const name of avds)
        if (!running.some((emulator) => emulator.name === name))
          catalog.devices.push({ id: `${AVD_PREFIX}${name}`, name, platform: 'android', state: 'shutdown' });
      if (!catalog.devices.some((device) => device.platform === 'android'))
        catalog.setup.push({
          platform: 'android',
          message: 'Create an Android virtual device in Android Studio.',
          url: 'https://developer.android.com/studio/run/managing-avds',
        });
    } catch {
      catalog.setup.push({
        platform: 'android',
        message: 'Install Android Studio and SDK Platform Tools, then create an emulator.',
        url: 'https://developer.android.com/studio',
      });
    }
    return catalog;
  }

  async boot(device: MobileDevice): Promise<MobileDevice | void> {
    if (device.platform === 'android' && device.id.startsWith(AVD_PREFIX))
      return this.bootAvd(device, device.id.slice(AVD_PREFIX.length));
    if (device.platform === 'ios' && device.state === 'shutdown') {
      await runMobileCommand('/usr/bin/xcrun', ['simctl', 'boot', device.id]);
      await runMobileCommand('/usr/bin/xcrun', ['simctl', 'bootstatus', device.id, '-b'], 90_000);
    }
    if (device.platform === 'ios') {
      await this.companions.start(device.id);
      const client = new IdbClient(this.companions.address(device.id), this.runtime.protoPath);
      this.clients.set(device.id, client);
      if ((await client.describe()).udid !== device.id) {
        this.detach(device);
        throw new Error('iOS bridge returned a different device. Attach again.');
      }
    }
  }

  private async runningEmulators(): Promise<{ serial: string; name: string }[]> {
    const output = (await runMobileCommand(this.adb, ['devices'])).toString();
    const serials = output
      .split('\n')
      .map((line) => /^(emulator-\d+)\s+device$/.exec(line.trim())?.[1])
      .filter((serial): serial is string => Boolean(serial));
    return Promise.all(
      serials.map(async (serial) => {
        const name = await runMobileCommand(this.adb, ['-s', serial, 'emu', 'avd', 'name']).then(
          (reply) => reply.toString().split('\n')[0]!.trim(),
          () => '',
        );
        return { serial, name: name || serial };
      }),
    );
  }

  private async bootAvd(device: MobileDevice, name: string): Promise<MobileDevice> {
    startMobileProcess(this.emulator, ['-avd', name]);
    for (let attempt = 0; attempt < ANDROID_BOOT_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, ANDROID_BOOT_POLL_MS));
      const match = (await this.runningEmulators().catch(() => [])).find((emulator) => emulator.name === name);
      if (!match) continue;
      const booted = await runMobileCommand(this.adb, ['-s', match.serial, 'shell', 'getprop', 'sys.boot_completed']).then(
        (reply) => reply.toString().trim() === '1',
        () => false,
      );
      if (booted) return { ...device, id: match.serial, state: 'booted' };
    }
    throw new Error('The Android emulator did not finish starting. Try again.');
  }

  detach(device: MobileDevice): void {
    this.clients.get(device.id)?.close();
    this.clients.delete(device.id);
    this.orientations.delete(device.id);
    if (device.platform === 'ios') this.companions.stop(device.id);
  }

  startView(device: MobileDevice, screen: DeviceScreen, onFrame: DeviceFrameListener, onError: (error: Error) => void): DeviceView | Promise<DeviceView> {
    if (device.platform === 'android') return AndroidLiveView.start(device.id, screen, onFrame, onError);
    const client = this.ios(device);
    let touch: ReturnType<IdbClient['openTouch']> | undefined;
    const stopVideo = client.startVideo(onFrame, onError);
    return {
      touch: (phase, x, y) => {
        if (phase === 'down') touch = client.openTouch(onError);
        if (!touch) throw new Error('No active touch.');
        touch.send(Math.floor(x / screen.scale), Math.floor(y / screen.scale));
        if (phase === 'up') { touch.close(); touch = undefined; }
      },
      stop: () => { stopVideo(); touch?.close(); touch = undefined; },
    };
  }

  async screen(device: MobileDevice): Promise<DeviceScreen> {
    const png =
      device.platform === 'ios'
        ? await this.ios(device).screenshot()
        : await runMobileCommand(this.adb, ['-s', device.id, 'exec-out', 'screencap', '-p']);
    if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error('Device returned an invalid screenshot.');
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20);
    if (!width || !height || width > 10000 || height > 10000) throw new Error('Invalid device screen dimensions.');
    let scale = 1;
    if (device.platform === 'ios') {
      const description = await this.ios(device).describe();
      const dimensions = description.screen_dimensions;
      scale = Number(dimensions?.width) / Number(dimensions?.width_points);
      if (!Number.isFinite(scale) || scale < 1 || scale > 4)
        throw new Error(
          'idb did not return the device screen scale. Update the app before controlling this simulator.',
        );
    }
    return { png, width, height, scale };
  }

  async perform(device: MobileDevice, action: MobileAction, screen?: DeviceScreen): Promise<void> {
    if (device.platform === 'ios') {
      const bridge = this.ios(device);
      const point = (value: number) => Math.floor(value / (screen?.scale ?? 1));
      switch (action.action) {
        case 'tap':
          return bridge.tap(point(action.x), point(action.y));
        case 'swipe':
          return bridge.swipe(
            point(action.x),
            point(action.y),
            point(action.toX),
            point(action.toY),
            action.durationMs / 1000,
          );
        case 'text':
          return bridge.text(action.text);
        case 'button':
          return bridge.button(action.button);
        case 'launch':
          return bridge.launch(action.appId);
      }
    }
    const point = (value: number) => String(Math.floor(value));
    let args: string[];
    switch (action.action) {
      case 'tap':
        args = ['tap', point(action.x), point(action.y)];
        break;
      case 'swipe':
        args = [
          'swipe',
          point(action.x),
          point(action.y),
          point(action.toX),
          point(action.toY),
          String(action.durationMs),
        ];
        break;
      case 'text':
        // ADB input supports ASCII, not a general Unicode IME.
        if (!/^[\x20-\x7e]*$/.test(action.text))
          throw new Error('Device typing supports printable ASCII. Use app-specific tooling for Unicode input.');
        if (action.text.includes('%s')) throw new Error('ADB cannot type a literal %s sequence.');
        args = ['text', shellQuote(action.text.replace(/ /g, '%s'))];
        break;
      case 'button': {
        const keys = { home: '3', back: '4', enter: '66', backspace: '67', volumeUp: '24', volumeDown: '25', power: '26' };
        args = ['keyevent', keys[action.button]];
        break;
      }
      case 'launch':
        const launch = await runMobileCommand(this.adb, [
          '-s',
          device.id,
          'shell',
          'monkey',
          '-p',
          action.appId,
          '-c',
          'android.intent.category.LAUNCHER',
          '1',
        ]);
        if (!/Events injected:\s*1\b/.test(launch.toString()))
          throw new Error('Android could not launch this app. Check that it is installed and has a launcher activity.');
        return;
    }
    await runMobileCommand(this.adb, ['-s', device.id, 'shell', 'input', ...args]);
  }

  async inspect(device: MobileDevice): Promise<string> {
    if (device.platform === 'ios') return this.ios(device).inspect();
    // No shared guest file: uiautomator writes directly to stdout through /dev/tty.
    const xml = (
      await runMobileCommand(this.adb, ['-s', device.id, 'exec-out', 'uiautomator', 'dump', '/dev/tty'])
    ).toString();
    if (!xml.includes('<hierarchy')) throw new Error('Android accessibility is unavailable.');
    return xml.slice(0, 100_000);
  }

  async rotate(device: MobileDevice): Promise<void> {
    if (device.platform === 'ios') {
      const bridge = this.ios(device);
      const next = IOS_ROTATION[await this.iosOrientation(device)]!;
      await bridge.setOrientation(next);
      this.orientations.set(device.id, next);
      return;
    }
    const read = await runMobileCommand(this.adb, ['-s', device.id, 'shell', 'settings', 'get', 'system', 'user_rotation']);
    const next = ((Number.parseInt(read.toString(), 10) || 0) + 1) % 4;
    await runMobileCommand(this.adb, ['-s', device.id, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
    await runMobileCommand(this.adb, ['-s', device.id, 'shell', 'settings', 'put', 'system', 'user_rotation', String(next)]);
  }

  async isRunning(device: MobileDevice): Promise<boolean> {
    if (device.platform === 'ios') {
      try {
        this.companions.address(device.id); // Throws once the helper exited with its simulator.
        return true;
      } catch {
        return false;
      }
    }
    try {
      const output = (await runMobileCommand(this.adb, ['devices'])).toString();
      return output.split('\n').some((line) => line.trim() === `${device.id}\tdevice`);
    } catch {
      return true; // adb itself failing says nothing about this device; keep the attachment.
    }
  }

  async setFolded(device: MobileDevice, folded: boolean): Promise<void> {
    if (device.platform !== 'ios' || !device.foldable) throw new Error('This simulator does not support folding.');
    const client = this.ios(device);
    const angle = folded ? 0 : 180;
    await client.setHingeAngle(angle);
    this.orientations.delete(device.id);
    // A delivered hinge event can precede the display switch. Do not restart
    // capture until the active screen agrees with the measured pose.
    const deadline = Date.now() + 10_000;
    do {
      const measured = await client.getHingeAngle();
      const target = await client.describe();
      if (Math.abs(measured - angle) <= 0.5 && target.displays?.some(display => display.active && display.integrated && display.name === (folded ? 'LCD' : 'LCD-1'))) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error('The simulator display is still changing. Try folding or unfolding again.');
  }

  async displayRotation(device: MobileDevice): Promise<0 | 1 | 2 | 3> {
    // Android rotates its framebuffer; iOS keeps it portrait and draws the rotated UI inside it.
    return device.platform === 'ios' ? HID_DISPLAY_ROTATION[await this.iosOrientation(device)] : 0;
  }

  private async iosOrientation(device: MobileDevice): Promise<0 | 1 | 2 | 3> {
    let current = this.orientations.get(device.id);
    if (current === undefined) {
      current = IDB_HID_ORIENTATION[await this.ios(device).getOrientation()] ?? 0;
      this.orientations.set(device.id, current);
    }
    return current;
  }

  async shutdown(device: MobileDevice): Promise<void> {
    if (device.platform === 'ios') await runMobileCommand('/usr/bin/xcrun', ['simctl', 'shutdown', device.id]);
    else await runMobileCommand(this.adb, ['-s', device.id, 'emu', 'kill']);
  }

  private ios(device: MobileDevice): IdbClient {
    this.companions.address(device.id); // Reject a dead helper instead of connecting to a stale socket.
    const client = this.clients.get(device.id);
    if (!client) throw new Error('iOS bridge disconnected. Attach again.');
    return client;
  }
}

/** HID orientation: 0 portrait, 1 upside down, 2 landscape left, 3 landscape right. */
const HID_DISPLAY_ROTATION: Record<0 | 1 | 2 | 3, 0 | 1 | 2 | 3> = { 0: 0, 3: 1, 1: 2, 2: 3 };
/** idb get_orientation values mapped to HID orientations. */
const IDB_HID_ORIENTATION: Record<number, 0 | 1 | 2 | 3> = { 1: 0, 2: 1, 3: 2, 4: 3 };
/** Clockwise quarter turns keyed by the current HID orientation. */
const IOS_ROTATION: Record<0 | 1 | 2 | 3, 0 | 1 | 2 | 3> = { 0: 3, 3: 1, 1: 2, 2: 0 };
export const AVD_PREFIX = 'avd:';
const ANDROID_BOOT_POLL_MS = 2_000;
const ANDROID_BOOT_ATTEMPTS = 90;

function androidRoots(): string[] {
  return [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library/Android/sdk'),
    path.join(os.homedir(), 'Android/Sdk'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk') : undefined,
  ].filter((root): root is string => Boolean(root));
}
function executable(name: string, candidates: string[]): string {
  return candidates.find((candidate) => existsSync(candidate)) ?? name;
}
function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
