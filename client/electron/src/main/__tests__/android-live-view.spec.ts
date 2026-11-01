// @vitest-environment node
import { Server, ServerCredentials, status, type ServiceDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidLiveView } from '../mobile/android-live-view';

// Independent Android Emulator wire contract; no SDK installation in unit tests.
const proto = `syntax="proto3"; package android.emulation.control;
message Empty {}
message Entry { string key=1; string value=2; }
message EntryList { repeated Entry entry=1; }
message Status { bool booted=3; EntryList hardwareConfig=5; }
message Rotation { int32 rotation=1; }
message ImageFormat { int32 format=1; Rotation rotation=2; uint32 width=3; uint32 height=4; }
message Image { ImageFormat format=1; bytes image=4; }
message Touch { int32 x=1; int32 y=2; int32 identifier=3; int32 pressure=4; }
message TouchEvent { repeated Touch touches=1; int32 display=2; }
service EmulatorController {
 rpc getStatus(Empty) returns (Status);
 rpc streamScreenshot(ImageFormat) returns (stream Image);
 rpc sendTouch(TouchEvent) returns (Empty);
}`;
let root: string, discovery: string, ini: string, server: Server, definition: ServiceDefinition;
let stream: any;
let tokenHeaders: string[], touches: any[], statusAvd: string;
let view: AndroidLiveView | undefined;
const screen = { png: Buffer.from('unused'), width: 1080, height: 2400, scale: 1 };
function png(width = 540, height = 1200) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'android-live-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  vi.stubEnv('XDG_RUNTIME_DIR', root);
  vi.spyOn(os, 'tmpdir').mockReturnValue(root);
  discovery =
    process.platform === 'darwin'
      ? path.join(root, 'Library/Caches/TemporaryItems/avd/running')
      : path.join(root, 'avd/running');
  await mkdir(discovery, { recursive: true });
  await mkdir(path.join(root, 'emulator/lib'), { recursive: true });
  const protoPath = path.join(root, 'emulator/lib/emulator_controller.proto');
  await writeFile(protoPath, proto);
  definition = loadSync(protoPath, { keepCase: true, longs: Number, defaults: true })[
    'android.emulation.control.EmulatorController'
  ] as ServiceDefinition;
  stream = undefined;
  touches = [];
  tokenHeaders = [];
  statusAvd = 'Pixel';
  server = new Server();
  server.addService(definition, {
    getStatus: (call: any, reply: Function) => {
      tokenHeaders.push(...call.metadata.get('authorization'));
      reply(null, {
        booted: true,
        hardwareConfig: {
          entry: [
            { key: 'avd.id', value: statusAvd },
            { key: 'hw.lcd.width', value: '1080' },
            { key: 'hw.lcd.height', value: '2400' },
          ],
        },
      });
    },
    streamScreenshot: (call: any) => {
      stream = call;
      tokenHeaders.push(...call.metadata.get('authorization'));
    },
    sendTouch: (call: any, reply: Function) => {
      touches.push(call.request);
      reply(null, {});
    },
  });
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (e, p) =>
      e ? reject(e) : resolve(p),
    ),
  );
  ini = `port.serial=5554\ngrpc.port=${port}\ngrpc.token=test-private-token\navd.id=Pixel\nlauncher.dir=${path.join(root, 'emulator')}\n`;
  await writeFile(path.join(discovery, `pid_${process.pid}.ini`), ini, { mode: 0o600 });
});
afterEach(async () => {
  view?.stop();
  await new Promise((r) => setTimeout(r, 20));
  server.forceShutdown();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  view = undefined;
});

describe('Android emulator live bridge', () => {
  it('uses the selected serial and bearer token, delivers native frames and sends movement before release', async () => {
    const frame = vi.fn(),
      failed = vi.fn();
    view = await AndroidLiveView.start('emulator-5554', screen, frame, failed);
    await vi.waitFor(() => expect(stream).toBeDefined());
    expect(stream.request).toMatchObject({ format: 0, width: 1200, height: 1200 });
    stream.write({ format: { format: 0, width: 540, height: 1200 }, image: png() });
    await vi.waitFor(() =>
      expect(frame).toHaveBeenCalledWith(png(), 'image/png', { width: 1080, height: 2400, rotation: 0 }),
    );
    await view.touch('down', 300, 1600);
    await view.touch('move', 300, 1200);
    expect(touches.map((t) => [t.touches[0].x, t.touches[0].y, t.touches[0].pressure])).toEqual([
      [300, 1600, 1],
      [300, 1200, 1],
    ]);
    expect(tokenHeaders).toEqual(['Bearer test-private-token', 'Bearer test-private-token']);
    view.stop();
    await vi.waitFor(() => expect(touches).toHaveLength(3));
    expect(touches[2].touches[0]).toMatchObject({ x: 300, y: 1200, pressure: 0 });
    expect(failed).not.toHaveBeenCalled();
  });
  it.each([
    [1, 1200, 540, 979, 200],
    [2, 540, 1200, 879, 2299],
    [3, 1200, 540, 100, 2199],
  ])('maps rotation %i to the physical input panel', async (angle, width, height, x, y) => {
    const frame = vi.fn();
    view = await AndroidLiveView.start('emulator-5554', screen, frame, vi.fn());
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream.write({
      format: { format: 0, width, height, rotation: { rotation: angle } },
      image: png(width, height),
    });
    await vi.waitFor(() => expect(frame).toHaveBeenCalled());
    expect(frame.mock.calls[0]![2]).toEqual({
      width: angle % 2 ? 2400 : 1080,
      height: angle % 2 ? 1080 : 2400,
      rotation: angle,
    });
    await view.touch('down', 200, 100);
    await view.touch('up', 200, 100);
    expect(touches[0].touches[0]).toMatchObject({ x, y, pressure: 1 });
  });
  it('refuses missing, mismatched and stale identities without opening a video stream', async () => {
    await expect(AndroidLiveView.start('physical-phone', screen, vi.fn(), vi.fn())).rejects.toThrow(
      'emulator',
    );
    await expect(AndroidLiveView.start('emulator-5556', screen, vi.fn(), vi.fn())).rejects.toThrow(
      'running emulator',
    );
    statusAvd = 'Other';
    await expect(AndroidLiveView.start('emulator-5554', screen, vi.fn(), vi.fn())).rejects.toThrow(
      'different',
    );
    expect(stream).toBeUndefined();
  });
  it('requires authenticated local discovery and hides endpoint diagnostics', async () => {
    const file = path.join(discovery, `pid_${process.pid}.ini`);
    await writeFile(file, ini.replace('grpc.token=test-private-token', 'grpc.token='));
    await expect(AndroidLiveView.start('emulator-5554', screen, vi.fn(), vi.fn())).rejects.toThrow(
      'authenticated',
    );
    await writeFile(file, ini);
    server.removeService(definition);
    server.addService(definition, {
      getStatus: (_: unknown, reply: Function) =>
        reply({ code: status.PERMISSION_DENIED, details: 'test-private-token sensitive data' }),
    });
    const error = await AndroidLiveView.start('emulator-5554', screen, vi.fn(), vi.fn()).catch((e) => e);
    expect(error.message).toContain('PERMISSION_DENIED');
    expect(error.message).not.toContain('test-private-token');
  });
  it.each(['invalid', 'rotated', 'off'] as const)(
    'stops %s video and allows the pane to report recovery',
    async (kind) => {
      const failed = vi.fn();
      view = await AndroidLiveView.start('emulator-5554', screen, vi.fn(), failed);
      await vi.waitFor(() => expect(stream).toBeDefined());
      stream.write({
        format: {
          format: 0,
          width: kind === 'off' ? 0 : 540,
          height: 1200,
          rotation: { rotation: kind === 'rotated' ? 1 : 0 },
        },
        image: kind === 'invalid' ? Buffer.from('bad') : png(),
      });
      await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    },
  );
});
