import { companionResponseLimit } from '@workspace/core/companion-protocol';
import { describeError } from './describe-error';

const maxQueuedFrames = 256;
/** A bulk producer resumes once the writer has caught up to this many frames, or half the byte cap. */
const resumeQueuedFrames = 32;
const maxQueuedBytes = companionResponseLimit * 2;

type Limits = { maxFrames: number; resumeFrames: number; maxBytes: number };
type Io = { write(bytes: Uint8Array): Promise<void>; fail(reason: 'send-queue-limit' | 'send-failed', detail?: string): void };

/**
 * Orders the frames of one update stream and bounds what waits to be written. A slow peer is cut off at the
 * caps; a bulk producer, like a catch-up replay, awaits `drained()` so a valid replay never trips them.
 */
export class UpdateStreamWriter {
  private frames = 0;
  private bytes = 0;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly io: Io, private readonly limits: Limits = { maxFrames: maxQueuedFrames, resumeFrames: resumeQueuedFrames, maxBytes: maxQueuedBytes }) {}

  get queuedFrames() { return this.frames; }
  get queuedBytes() { return this.bytes; }

  enqueue(bytes: Uint8Array): void {
    if (this.closed) return;
    this.frames++; this.bytes += bytes.byteLength;
    if (this.frames > this.limits.maxFrames || this.bytes > this.limits.maxBytes) { this.close(); this.io.fail('send-queue-limit'); return; }
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      await this.io.write(bytes);
      this.frames--; this.bytes -= bytes.byteLength;
      this.release();
    }).catch((error) => { this.close(); this.io.fail('send-failed', describeError(error)); });
  }

  /** Resolves when the queue has room for more; immediately if it already does or the stream is closed. */
  drained(): Promise<void> {
    return this.closed || this.hasRoom() ? Promise.resolve() : new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  close(): void { this.closed = true; this.release(); }

  private hasRoom() { return this.frames <= this.limits.resumeFrames && this.bytes <= this.limits.maxBytes / 2; }
  private release() { if (this.closed || this.hasRoom()) for (const wake of this.waiters.splice(0)) wake(); }
}
