import {
  Client,
  credentials,
  Metadata,
  status,
  type ClientReadableStream,
  type ServiceDefinition,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeviceFrameListener, DeviceScreen, DeviceView } from './adapter';

type Message = Record<string, any>;
const MAX_BYTES = 12 * 1024 * 1024;
const PREFIX = 'android.emulation.control.EmulatorController';

/** Uses the SDK emulator's authenticated loopback API, never a physical or remote device. */
export class AndroidLiveView implements DeviceView {
  private readonly client: Client;
  private readonly methods: ServiceDefinition;
  private readonly metadata = new Metadata();
  private stream?: ClientReadableStream<Message>;
  private held?: { x: number; y: number };
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private rotation = 0;
  private width = 0;
  private height = 0;

  private constructor(
    endpoint: { port: number; token: string; proto: string },
    private readonly failed: (error: Error) => void,
  ) {
    this.methods = loadSync(endpoint.proto, { keepCase: true, longs: Number, defaults: true })[
      PREFIX
    ] as ServiceDefinition;
    if (!this.methods?.getStatus || !this.methods.streamScreenshot || !this.methods.sendTouch)
      throw new Error('Update Android SDK Emulator to use live video.');
    this.metadata.set('authorization', `Bearer ${endpoint.token}`);
    this.client = new Client(`127.0.0.1:${endpoint.port}`, credentials.createInsecure(), {
      'grpc.max_receive_message_length': MAX_BYTES,
      'grpc.max_send_message_length': 64 * 1024,
      'grpc.enable_retries': 0,
    });
  }

  static async start(
    serial: string,
    screen: DeviceScreen,
    frame: DeviceFrameListener,
    failed: (error: Error) => void,
  ): Promise<AndroidLiveView> {
    const endpoint = await discover(serial);
    const view = new AndroidLiveView(endpoint, failed);
    try {
      const state = await view.unary('getStatus', {});
      const avd = state.hardwareConfig?.entry?.find((item: Message) => item.key === 'avd.id')?.value;
      if (avd !== endpoint.avd)
        throw new Error('Android bridge returned a different emulator. Reconnect the device.');
      if (!state.booted) throw new Error('Wait for the Android emulator to finish booting, then retry.');
      const hardware = Object.fromEntries(
        (state.hardwareConfig?.entry ?? []).map((entry: Message) => [entry.key, entry.value]),
      );
      view.width = Number(hardware['hw.lcd.width']);
      view.height = Number(hardware['hw.lcd.height']);
      if (![view.width, view.height].every((value) => Number.isInteger(value) && value > 0 && value <= 16384))
        throw new Error('Android display dimensions are unavailable. Reconnect the emulator.');
      view.capture(screen, frame);
      return view;
    } catch (error) {
      view.client.close();
      throw error;
    }
  }

  private capture(screen: DeviceScreen, frame: DeviceFrameListener): void {
    const method = this.methods.streamScreenshot!;
    const stream = this.client.makeServerStreamRequest<Message, Message>(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      {
        format: 0,
        width: Math.ceil(Math.max(screen.width, screen.height) / 2),
        height: Math.ceil(Math.max(screen.width, screen.height) / 2),
      },
      this.metadata,
    );
    this.stream = stream;
    stream.on('data', (message: Message) => {
      if (this.stopped) return;
      const { width, height, rotation } = message.format ?? {};
      const png = message.image as Buffer;
      if (!width || !height)
        return this.fail(new Error('Android display is off. Wake the emulator, then reconnect the view.'));
      const angle = rotation?.rotation ?? 0;
      const odd = angle % 2 === 1;
      const fullWidth = odd ? this.height : this.width,
        fullHeight = odd ? this.width : this.height;
      if (![0, 1, 2, 3].includes(angle) || Math.abs(width / height - fullWidth / fullHeight) > 0.01)
        return this.fail(new Error('Android display configuration changed. Reconnect the view.'));
      if (
        !Buffer.isBuffer(png) ||
        png.length < 24 ||
        png.length > MAX_BYTES ||
        !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.readUInt32BE(16) !== width ||
        png.readUInt32BE(20) !== height
      )
        return this.fail(new Error('Android returned an invalid video frame. Reconnect the view.'));
      this.rotation = angle;
      frame(png, 'image/png', { width: fullWidth, height: fullHeight, rotation: angle });
    });
    stream.once('error', (error) => this.fail(rpcError(error)));
    stream.once('end', () =>
      this.fail(new Error('Android video stopped. Check the emulator and reconnect the view.')),
    );
  }

  async touch(phase: 'down' | 'move' | 'up', x: number, y: number): Promise<void> {
    if (this.stopped) throw new Error('Android view ended. Reconnect the view.');
    // Inverse of the framebuffer rotation: native touch always addresses the physical panel.
    const points = [
      { x, y },
      { x: this.width - 1 - y, y: x },
      { x: this.width - 1 - x, y: this.height - 1 - y },
      { x: y, y: this.height - 1 - x },
    ];
    const transformed = points[this.rotation]!;
    const point = { x: Math.floor(transformed.x), y: Math.floor(transformed.y) };
    // Remember even a pending DOWN so close can release after an in-flight request.
    this.held = point;
    const result = this.unary('sendTouch', {
      touches: [{ ...point, identifier: 0, pressure: phase === 'up' ? 0 : 1 }],
    });
    this.pending = result.catch(() => undefined);
    try {
      await result;
      if (phase === 'up') this.held = undefined;
    } catch (error) {
      this.fail(error as Error);
      throw error;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stream?.cancel();
    void this.pending
      .then(async () => {
        if (this.held)
          await this.unary('sendTouch', { touches: [{ ...this.held, identifier: 0, pressure: 0 }] }).catch(
            () => undefined,
          );
      })
      .finally(() => this.client.close());
  }
  private fail(error: Error): void {
    if (this.stopped) return;
    this.stop();
    this.failed(error);
  }
  private unary(name: string, input: Message): Promise<Message> {
    const method = this.methods[name]!;
    return new Promise((resolve, reject) => {
      this.client.makeUnaryRequest<Message, Message>(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        input,
        this.metadata,
        { deadline: Date.now() + 4_000 },
        (error, value) => (error ? reject(rpcError(error)) : resolve(value!)),
      );
    });
  }
}

function rpcError(error: { code?: number }): Error {
  return new Error(
    `Android live bridge failed (${status[error.code ?? status.UNKNOWN]}). Check the emulator and reconnect the view.`,
  );
}

async function discover(
  serial: string,
): Promise<{ port: number; token: string; proto: string; avd: string }> {
  const match = /^emulator-(\d+)$/.exec(serial);
  if (!match) throw new Error('Live video requires a local Android emulator.');
  const directory =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Caches/TemporaryItems/avd/running')
      : path.join(
          process.platform === 'win32' ? os.tmpdir() : process.env.XDG_RUNTIME_DIR || os.tmpdir(),
          'avd/running',
        );
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter((name) => /^pid_\d+(?:_info)?\.ini$/.test(name)).slice(0, 256)) {
    let config: Record<string, string>;
    try {
      const filename = path.join(directory, file);
      const info = await stat(filename);
      if (!info.isFile() || info.size > 64 * 1024 || (process.getuid && info.uid !== process.getuid()))
        continue;
      process.kill(Number(/^pid_(\d+)/.exec(file)![1]), 0);
      config = Object.fromEntries(
        (await readFile(filename, 'utf8'))
          .split(/\r?\n/)
          .filter((line) => line.includes('='))
          .map((line) => {
            const split = line.indexOf('=');
            return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
          }),
      );
    } catch {
      continue;
    }
    if (config['port.serial'] !== match[1]) continue;
    const port = Number(config['grpc.port']),
      token = config['grpc.token'],
      launcher = config['launcher.dir'];
    if (
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      !token ||
      !/^[\x21-\x7e]{1,8192}$/.test(token) ||
      config['grpc.server_cert']
    )
      throw new Error(
        'Android live video needs an authenticated local emulator. Restart it from Android Studio or the simulator picker.',
      );
    if (!launcher || !path.isAbsolute(launcher) || !config['avd.id']) break;
    const proto = path.join(launcher, 'lib', 'emulator_controller.proto');
    if (
      !(await stat(proto).then(
        (info) => info.isFile() && info.size < 512 * 1024,
        () => false,
      ))
    )
      throw new Error('Android Emulator protocol is missing. Update SDK Emulator in Android Studio.');
    return { port, token, proto, avd: config['avd.id'] };
  }
  throw new Error(
    'Cannot find the running emulator’s live bridge. Restart it from Android Studio or the simulator picker.',
  );
}
