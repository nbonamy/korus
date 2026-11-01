import {
  Client,
  credentials,
  status,
  type ClientWritableStream,
  type ClientUnaryCall,
  type ClientDuplexStream,
  type ServiceDefinition,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import path from 'node:path';

type Message = Record<string, unknown>;
type Call = ClientUnaryCall | ClientWritableStream<Message> | ClientDuplexStream<Message, Message>;
type Target = { udid: string; screen_dimensions?: { width: number; width_points: number }; displays?: { name: string; integrated: boolean; active: boolean }[] };
const MAX_BYTES = 12 * 1024 * 1024;
const KEY_DELAY_SECONDS = 0.03;
const TEXT_CHUNK = 100;

/** Only the app-owned companion's private Unix socket is accepted. No registry or network discovery. */
export class IdbClient {
  private readonly client: Client;
  private readonly methods: ServiceDefinition;
  private readonly calls = new Set<Call>();
  private closed = false;

  constructor(socket: string, protoPath: string) {
    if (!path.isAbsolute(socket)) throw new Error('iOS bridge requires a private Unix socket.');
    this.methods = loadSync(protoPath, { keepCase: true, longs: Number, defaults: true })[
      'idb.CompanionService'
    ] as ServiceDefinition;
    this.client = new Client(`unix:${socket}`, credentials.createInsecure(), {
      'grpc.max_receive_message_length': MAX_BYTES,
      'grpc.max_send_message_length': MAX_BYTES,
      'grpc.enable_retries': 0,
    });
  }

  close(): void {
    this.closed = true;
    for (const call of this.calls) call.cancel();
    this.calls.clear();
    this.client.close();
  }

  async describe(): Promise<Target> {
    return (await this.unary('describe', {})).target_description as Target;
  }
  async screenshot(): Promise<Buffer> {
    return (await this.unary('screenshot', {})).image_data as Buffer;
  }
  /** HID orientation: 0 portrait, 1 upside down, 2 landscape left, 3 landscape right. */
  async setOrientation(orientation: 0 | 1 | 2 | 3): Promise<void> {
    await this.unary('set_orientation', { orientation });
  }
  /** idb orientation: 1 portrait, 2 upside down, 3 landscape left, 4 landscape right; 0 when unknown. */
  async getOrientation(): Promise<number> {
    return Number((await this.unary('get_orientation', {})).orientation) || 0;
  }
  async setHingeAngle(angle: 0 | 180): Promise<void> {
    await this.hid([{ hinge: { angle } }]);
  }
  async getHingeAngle(): Promise<number> {
    return Number((await this.unary('hinge_angle', {})).angle);
  }
  async inspect(): Promise<string> {
    const value = (await this.unary('accessibility_info', { format: 0 })).json;
    if (typeof value !== 'string' || !value) throw new Error('iOS accessibility is unavailable.');
    return value.slice(0, 100_000);
  }
  /** Native JPEG video with Minicap length framing; no screenshot RPCs in this path. */
  startVideo(onFrame: (jpeg: Buffer) => void, onError: (error: Error) => void): () => void {
    if (this.closed) throw new Error('iOS bridge is closed. Attach again.');
    const method = this.methods.video_stream!;
    const call = this.client.makeBidiStreamRequest<Message, Message>(
      method.path, method.requestSerialize, method.responseDeserialize,
    );
    this.calls.add(call);
    let stopped = false;
    let header = false;
    let buffer: Buffer = Buffer.alloc(0);
    const stop = () => {
      stopped = true;
      buffer = Buffer.alloc(0);
      this.calls.delete(call);
      call.cancel();
    };
    const fail = (error: Error) => {
      if (stopped) return;
      stop();
      onError(error);
    };
    call.on('data', (value: Message) => {
      if (stopped) return;
      const data = (value.payload as { data?: Buffer } | undefined)?.data;
      if (!data?.length) return;
      if (buffer.length + data.length > MAX_BYTES) return fail(new Error('Invalid iOS video frame size.'));
      buffer = Buffer.concat([buffer, data]);
      if (!header) {
        if (buffer.length < 24) return;
        if (buffer[0] !== 1 || buffer[1] !== 24) return fail(new Error('Invalid iOS video header.'));
        buffer = buffer.subarray(24);
        header = true;
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32LE(0);
        if (size < 4 || size > MAX_BYTES - 4) return fail(new Error('Invalid iOS video frame size.'));
        if (buffer.length < size + 4) return;
        const jpeg = buffer.subarray(4, 4 + size);
        if (jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[size - 2] !== 255 || jpeg[size - 1] !== 217)
          return fail(new Error('Invalid iOS video frame.'));
        buffer = buffer.subarray(4 + size);
        onFrame(jpeg);
        if (stopped) return;
      }
    });
    call.once('error', (error) => fail(bridgeError(error)));
    call.once('end', () => fail(new Error('iOS video stream stopped. Reconnect the view.')));
    call.write({ start: { fps: 60, format: 3, compression_quality: 0.7, scale_factor: 0.5 } });
    return stop;
  }

  /** One HID RPC spans a gesture so moves arrive before pointer-up. */
  openTouch(onError: (error: Error) => void): { send(x: number, y: number): void; close(): void } {
    if (this.closed) throw new Error('iOS bridge is closed. Attach again.');
    const method = this.methods.hid!;
    let ended = false;
    let point: { x: number; y: number } | undefined;
    const call = this.client.makeClientStreamRequest<Message, Message>(
      method.path, method.requestSerialize, method.responseDeserialize,
      { deadline: Date.now() + 15_000 },
      (error) => {
        this.calls.delete(call);
        if (error) onError(bridgeError(error));
      },
    );
    this.calls.add(call);
    return {
      send: (x, y) => {
        if (ended) throw new Error('Touch session ended.');
        point = { x, y };
        if (!call.write({ press: { action: { touch: { point } }, direction: 0 } })) {
          ended = true;
          call.end({ press: { action: { touch: { point } }, direction: 1 } });
          throw new Error('Simulator input is busy. Release and try again.');
        }
      },
      close: () => {
        if (ended) return;
        ended = true;
        if (point) call.write({ press: { action: { touch: { point } }, direction: 1 } });
        call.end();
      },
    };
  }
  async tap(x: number, y: number): Promise<void> {
    await this.hid(press({ touch: { point: { x, y } } }));
  }
  async swipe(x: number, y: number, toX: number, toY: number, duration: number): Promise<void> {
    await this.hid([{ swipe: { start: { x, y }, end: { x: toX, y: toY }, duration } }]);
  }
  async button(button: 'home' | 'enter' | 'backspace' | 'back' | 'volumeUp' | 'volumeDown' | 'power'): Promise<void> {
    if (button === 'back') throw new Error('iOS has no Back button.');
    // idb HID buttons: 1 home, 2 lock (the side button), 6 volume up, 7 volume down.
    const hardware = { home: 1, power: 2, volumeUp: 6, volumeDown: 7 } as const;
    if (button in hardware) return this.hid(press({ button: { button: hardware[button as keyof typeof hardware] } }));
    await this.hid(press({ key: { keycode: button === 'enter' ? 40 : 42 } }));
  }
  async text(text: string): Promise<void> {
    if (text.length > 2000 || !/^[\x20-\x7e]*$/.test(text))
      throw new Error('Device typing supports printable ASCII, up to 2000 characters.');
    // iOS drops or reorders keys it cannot keep up with (a following Enter then submits a partial query),
    // so keys are paced, and long text is sent in chunks that each fit the call deadline.
    const characters = [...text];
    for (let start = 0; start < characters.length; start += TEXT_CHUNK) {
      const events: Message[] = [];
      for (const character of characters.slice(start, start + TEXT_CHUNK)) {
        const [keycode, shifted] = asciiKey(character);
        if (shifted) events.push({ press: { action: { key: { keycode: 225 } }, direction: 0 } });
        events.push(...press({ key: { keycode } }));
        if (shifted) events.push({ press: { action: { key: { keycode: 225 } }, direction: 1 } });
        events.push({ delay: { duration: KEY_DELAY_SECONDS } });
      }
      await this.hid(events);
    }
  }
  async launch(bundleId: string): Promise<void> {
    if (this.closed) throw new Error('iOS bridge is closed. Attach again.');
    const method = this.methods.launch!;
    await new Promise<void>((resolve, reject) => {
      const call = this.client.makeBidiStreamRequest<Message, Message>(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        { deadline: Date.now() + 15_000 },
      );
      this.calls.add(call);
      let received = 0;
      call.on('data', (value: Message) => {
        received += method.responseSerialize(value).length;
        if (received > MAX_BYTES) call.cancel();
      });
      call.once('error', (error) => {
        this.calls.delete(call);
        reject(bridgeError(error));
      });
      call.once('end', () => {
        this.calls.delete(call);
        resolve();
      });
      call.end({ start: { bundle_id: bundleId, foreground_if_running: true, wait_for: false } });
    });
  }

  private async unary(name: string, request: Message): Promise<Message> {
    if (this.closed) throw new Error('iOS bridge is closed. Attach again.');
    const method = this.methods[name]!;
    return new Promise((resolve, reject) => {
      const call = this.client.makeUnaryRequest<Message, Message>(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        { deadline: Date.now() + 15_000 },
        (error, result) => {
          this.calls.delete(call);
          if (error) reject(bridgeError(error));
          else resolve(result!);
        },
      );
      this.calls.add(call);
    });
  }
  private async hid(events: Message[]): Promise<void> {
    if (this.closed) throw new Error('iOS bridge is closed. Attach again.');
    const method = this.methods.hid!;
    await new Promise<void>((resolve, reject) => {
      const call = this.client.makeClientStreamRequest<Message, Message>(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        { deadline: Date.now() + 15_000 },
        (error) => {
          this.calls.delete(call);
          if (error) reject(bridgeError(error));
          else resolve();
        },
      );
      this.calls.add(call);
      for (const event of events) call.write(event);
      call.end();
    });
  }
}

function press(action: Message): Message[] {
  return [{ press: { action, direction: 0 } }, { press: { action, direction: 1 } }];
}
function bridgeError(error: { code?: number }): Error {
  return new Error(
    `iOS bridge request failed (${status[error.code ?? status.UNKNOWN]}). Check the simulator or detach and attach again.`,
  );
}
// USB HID keyboard usage IDs for the simulator's US ASCII keyboard, including balanced Shift presses.
function asciiKey(character: string): [number, boolean] {
  if (/[a-z]/i.test(character))
    return [character.toLowerCase().charCodeAt(0) - 97 + 4, character !== character.toLowerCase()];
  const digits = '1234567890';
  if (digits.includes(character)) return [30 + digits.indexOf(character), false];
  const shiftedDigits = '!@#$%^&*()';
  if (shiftedDigits.includes(character)) return [30 + shiftedDigits.indexOf(character), true];
  const punctuation = [' ', '-_', '=+', '[{', ']}', '\\|', ';:', '\'"', '`~', ',<', '.>', '/?'];
  const keycodes = [44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56];
  const index = punctuation.findIndex((pair) => pair.includes(character));
  return [keycodes[index]!, punctuation[index]!.indexOf(character) === 1];
}
