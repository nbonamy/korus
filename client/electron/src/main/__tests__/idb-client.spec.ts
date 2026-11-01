// @vitest-environment node
import { Server, ServerCredentials, status, type ServiceDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbClient } from '../mobile/idb-client';
const proto = path.resolve(import.meta.dirname, '../../../resources/mobile-simulator/idb.proto');
const definition = loadSync(proto, { keepCase: true, longs: Number, defaults: true })[
  'idb.CompanionService'
] as ServiceDefinition;
let directory: string;
let server: Server;
let client: IdbClient;
let events: unknown[];
let launch: unknown;
let hanging: boolean;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'idb-wire-'));
  events = [];
  hanging = false;
  server = new Server();
  server.addService(definition, {
    describe: (_call: unknown, reply: Function) =>
      reply(null, { target_description: { udid: 'phone', screen_dimensions: { width: 1206, width_points: 402 } } }),
    screenshot: (_call: unknown, reply: Function) => {
      if (!hanging) reply(null, { image_data: Buffer.from([0, 137, 255]) });
    },
    accessibility_info: (_call: unknown, reply: Function) => reply(null, { json: '[{"AXLabel":"Settings"}]' }),
    hid: (call: NodeJS.ReadableStream, reply: Function) => {
      call.on('data', (value) => events.push(value));
      call.on('end', () => reply(null, {}));
    },
    launch: (call: NodeJS.ReadWriteStream) => {
      call.on('data', (value) => {
        launch = value;
      });
      call.on('end', () => call.end());
    },
  });
  const socket = path.join(directory, 'bridge.sock');
  await new Promise<void>((resolve, reject) =>
    server.bindAsync(`unix:${socket}`, ServerCredentials.createInsecure(), (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  client = new IdbClient(socket, proto);
});
afterEach(async () => {
  client.close();
  server.forceShutdown();
  await rm(directory, { recursive: true, force: true });
});

describe('idb companion wire protocol', () => {
  it('delivers framed native video across fragmented messages and cancels capture on close', async () => {
    let stream: any;
    let request: any;
    const cancelled = vi.fn();
    server.removeService(definition);
    server.addService(definition, {
      video_stream: (call: any) => {
        stream = call;
        call.on('data', (value: any) => { request = value; });
        call.on('cancelled', cancelled);
      },
    });
    const frames = vi.fn(), failed = vi.fn();
    const stop = client.startVideo(frames, failed);
    await vi.waitFor(() => expect(request?.start).toMatchObject({ format: 3, fps: 60 }));
    const header = Buffer.alloc(24);
    header[0] = 1; header[1] = 24;
    const jpeg = Buffer.from([255, 216, 1, 2, 255, 217]);
    const length = Buffer.alloc(4); length.writeUInt32LE(jpeg.length);
    const bytes = Buffer.concat([header, length, jpeg, length, jpeg]);
    stream.write({ payload: { data: bytes.subarray(0, 25) } });
    stream.write({ payload: { data: bytes.subarray(25, 30) } });
    stream.write({ payload: { data: bytes.subarray(30) } });
    await vi.waitFor(() => expect(frames).toHaveBeenCalledTimes(2));
    expect(frames).toHaveBeenLastCalledWith(jpeg);
    stop();
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
    expect(failed).not.toHaveBeenCalled();
  });

  it('rejects malformed video framing and reports a stopped native stream', async () => {
    let stream: any;
    server.removeService(definition);
    server.addService(definition, { video_stream: (call: any) => { stream = call; call.on('data', () => {}); } });
    const failed = vi.fn();
    client.startVideo(vi.fn(), failed);
    await vi.waitFor(() => expect(stream).toBeDefined());
    const bytes = Buffer.alloc(28); bytes[0] = 1; bytes[1] = 24; bytes.writeUInt32LE(20 * 1024 * 1024, 24);
    stream.write({ payload: { data: bytes } });
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('video') })));
    stream = undefined;
    client.startVideo(vi.fn(), failed);
    await vi.waitFor(() => expect(stream).toBeDefined());
    stream.end();
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  });

  it('sends drag movement before release and releases a held touch when the pane closes', async () => {
    const failed = vi.fn();
    const touch = client.openTouch(failed);
    touch.send(100, 200);
    touch.send(110, 180);
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events.map((event: any) => [event.press.direction, event.press.action.touch.point])).toEqual([
      [0, { x: 100, y: 200 }], [0, { x: 110, y: 180 }],
    ]);
    touch.close();
    await vi.waitFor(() => expect(events).toHaveLength(3));
    expect(events[2]).toMatchObject({ press: { direction: 1, action: { touch: { point: { x: 110, y: 180 } } } } });
    expect(failed).not.toHaveBeenCalled();
  });
  it('reads binary screenshots, device dimensions and accessibility over the private socket', async () => {
    expect((await client.describe()).udid).toBe('phone');
    expect(await client.screenshot()).toEqual(Buffer.from([0, 137, 255]));
    expect(await client.inspect()).toContain('Settings');
  });
  it('delivers touch, swipe, Home, shifted ASCII and foreground launch in wire order', async () => {
    await client.setHingeAngle(0);
    await client.setHingeAngle(180);
    expect(events).toStrictEqual([{ hinge: { angle: 0 } }, { hinge: { angle: 180 } }]);
    events = [];
    await client.tap(100, 200);
    await client.swipe(100, 200, 300, 400, 0.5);
    await client.button('home');
    await client.text('Az!');
    expect(events.slice(0, 2)).toMatchObject([
      { press: { direction: 0, action: { touch: { point: { x: 100, y: 200 } } } } },
      { press: { direction: 1 } },
    ]);
    expect(events[2]).toMatchObject({ swipe: { start: { x: 100, y: 200 }, end: { x: 300, y: 400 }, duration: 0.5 } });
    expect(events[3]).toMatchObject({ press: { action: { button: { button: 1 } } } });
    expect(events.slice(5).filter((event: any) => event.press).map((event: any) => [event.press.action.key.keycode, event.press.direction])).toEqual([
      [225, 0],
      [4, 0],
      [4, 1],
      [225, 1],
      [29, 0],
      [29, 1],
      [225, 0],
      [30, 0],
      [30, 1],
      [225, 1],
    ]);
    events = [];
    await client.text('0 :\\');
    await client.button('enter');
    await client.button('backspace');
    expect(events.filter((event: any) => event.press).map((event: any) => [event.press.action.key.keycode, event.press.direction])).toEqual([
      [39, 0],
      [39, 1],
      [44, 0],
      [44, 1],
      [225, 0],
      [51, 0],
      [51, 1],
      [225, 1],
      [49, 0],
      [49, 1],
      [40, 0],
      [40, 1],
      [42, 0],
      [42, 1],
    ]);
    events = [];
    await client.text('ab');
    expect(events.map((event: any) => (event.delay ? 'pause' : `${event.press.action.key.keycode}:${event.press.direction}`))).toEqual([
      '4:0', '4:1', 'pause', '5:0', '5:1', 'pause',
    ]);
    expect(events.find((event: any) => event.delay)).toMatchObject({ delay: { duration: 0.03 } });
    events = [];
    await client.text('x'.repeat(250));
    expect(events.filter((event: any) => event.delay)).toHaveLength(250);
    events = [];
    await client.button('volumeUp');
    await client.button('volumeDown');
    await client.button('power');
    expect(events.filter((event: any) => event.press.direction === 0).map((event: any) => event.press.action.button.button)).toEqual([6, 7, 2]);
    await expect(client.button('back')).rejects.toThrow('no Back');
    await expect(client.text('é')).rejects.toThrow('ASCII');
    await client.launch('com.example.app');
    expect(launch).toMatchObject({
      start: { bundle_id: 'com.example.app', foreground_if_running: true, wait_for: false },
    });
  });
  it('rejects oversized screenshots and failed launches rather than reporting success', async () => {
    server.removeService(definition);
    server.addService(definition, {
      screenshot: (_call: unknown, reply: Function) => reply(null, { image_data: Buffer.alloc(12 * 1024 * 1024 + 1) }),
      launch: (call: NodeJS.ReadWriteStream) =>
        call.emit('error', { code: status.NOT_FOUND, details: 'private app identifier' }),
      accessibility_info: (_call: unknown, reply: Function) => reply(null, { json: '' }),
    });
    await expect(client.screenshot()).rejects.toThrow('RESOURCE_EXHAUSTED');
    await expect(client.launch('com.missing.app')).rejects.toThrow('NOT_FOUND');
    await expect(client.inspect()).rejects.toThrow('unavailable');
  });

  it('cancels an in-flight capture on detach and refuses subsequent requests', async () => {
    hanging = true;
    const result = client.screenshot();
    const failure = expect(result).rejects.toThrow('iOS bridge');
    client.close();
    await failure;
    await expect(client.screenshot()).rejects.toThrow('closed');
  });
  it('bounds calls with a deadline and does not expose server diagnostics', async () => {
    hanging = true;
    client.close();
    client = new IdbClient(path.join(directory, 'bridge.sock'), proto);
    await expect(client.screenshot()).rejects.toThrow('DEADLINE_EXCEEDED');
    server.removeService(definition);
    server.addService(definition, {
      screenshot: (_call: unknown, reply: Function) => reply({ code: status.INTERNAL, details: 'private app data' }),
    });
    const error = await client.screenshot().catch((error) => error);
    expect(error.message).toContain('INTERNAL');
    expect(error.message).not.toContain('private app data');
  }, 20_000);
});
