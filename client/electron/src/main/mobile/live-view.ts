import { randomUUID } from 'node:crypto';
import type { MobileViewResult } from '@workspace/core/mobile-simulator';
import type { DeviceFrameListener, DeviceView } from './adapter';

/** Latest-frame mailbox: a slow renderer cannot accumulate video or input queues. */
export class MobileLiveView {
  readonly id = randomUUID();
  touching = false;
  /** Quarter turns clockwise that show the framebuffer upright; the host updates it when the device rotates. */
  displayRotation: 0 | 1 | 2 | 3 = 0;
  private device?: DeviceView;
  private latest?: { data: Buffer; mimeType: 'image/jpeg' | 'image/png' };
  private receivedFrame = false;
  private geometry = 0;
  private rotation = 0;
  private inputPending = false;
  private failure?: Error;
  private closed = false;
  private waiting?: { resolve(value: MobileViewResult): void; reject(error: Error): void };
  private lease?: ReturnType<typeof setTimeout>;
  private readTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private width: number,
    private height: number,
  ) {
    this.renew();
  }

  async connect(
    start: (
      onFrame: DeviceFrameListener,
      onError: (error: Error) => void,
    ) => DeviceView | Promise<DeviceView>,
  ): Promise<void> {
    try {
      this.device = await start(
        (data, mimeType = 'image/jpeg', geometry) => {
          if (this.closed) return;
          if (
            geometry &&
            (geometry.width !== this.width ||
              geometry.height !== this.height ||
              geometry.rotation !== this.rotation)
          ) {
            if (this.touching) {
              this.close(new Error('Display changed during touch. Reconnect the view.'));
              return;
            }
            this.width = geometry.width;
            this.height = geometry.height;
            this.rotation = geometry.rotation;
            this.geometry++;
          }
          this.receivedFrame = true;
          this.latest = { data, mimeType };
          if (this.waiting) {
            const waiting = this.waiting;
            this.waiting = undefined;
            clearTimeout(this.readTimeout);
            waiting.resolve(this.take());
          }
        },
        (error) => this.close(error),
      );
      if (this.closed) this.device.stop();
    } catch (error) {
      this.close(error instanceof Error ? error : new Error('Live view failed.'));
      throw error;
    }
  }

  next(): Promise<MobileViewResult> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ viewId: this.id, ended: true });
    if (this.waiting) return Promise.reject(new Error('A video frame read is already pending.'));
    this.renew();
    if (this.latest) return Promise.resolve(this.take());
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.readTimeout = setTimeout(() => {
        if (!this.receivedFrame) this.close(new Error('Simulator video timed out. Reconnect the view.'));
        else {
          this.waiting = undefined;
          resolve({ viewId: this.id });
        }
      }, 10_000);
    });
  }

  async touch(phase: 'down' | 'move' | 'up', x: number, y: number, geometry: number): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('Simulator view ended.');
    if (geometry !== this.geometry)
      throw new Error('Display changed. Wait for a fresh frame before touching.');
    if (this.inputPending) throw new Error('A touch request is already pending.');
    if (
      !['down', 'move', 'up'].includes(phase) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= (this.displayRotation % 2 ? this.height : this.width) ||
      y >= (this.displayRotation % 2 ? this.width : this.height)
    )
      throw new Error('Invalid live touch coordinates.');
    if ((phase === 'down') === this.touching)
      throw new Error('Invalid touch sequence. Release and try again.');
    this.inputPending = true;
    this.touching = true;
    try {
      await this.device!.touch(phase, x, y);
      if (this.failure) throw this.failure;
      if (this.closed) return;
      this.touching = phase !== 'up';
    } catch (error) {
      this.close(error instanceof Error ? error : new Error('Simulator input failed.'));
      throw error;
    } finally {
      this.inputPending = false;
    }
  }

  close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    clearTimeout(this.lease);
    clearTimeout(this.readTimeout);
    this.latest = undefined;
    if (error) this.waiting?.reject(error);
    else this.waiting?.resolve({ viewId: this.id, ended: true });
    this.waiting = undefined;
    this.touching = false;
    this.device?.stop();
  }

  private renew(): void {
    clearTimeout(this.lease);
    this.lease = setTimeout(
      () => this.close(new Error('Simulator view expired. Reconnect the view.')),
      15_000,
    );
  }
  private take(): MobileViewResult {
    const data = new Uint8Array(this.latest!.data),
      mimeType = this.latest!.mimeType;
    this.latest = undefined;
    return {
      viewId: this.id,
      frame: {
        data,
        mimeType,
        width: this.width,
        height: this.height,
        geometry: this.geometry,
        rotation: this.displayRotation,
      },
    };
  }
}
