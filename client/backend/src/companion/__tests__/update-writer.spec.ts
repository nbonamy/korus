import { describe, expect, it, vi } from 'vitest';
import { UpdateStreamWriter } from '../update-writer';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
/** A writer whose frames leave only when the test lets them, like a stalled peer. */
function fixture(limits?: ConstructorParameters<typeof UpdateStreamWriter>[1]) {
  const releases: (() => void)[] = []; const fail = vi.fn();
  const writer = new UpdateStreamWriter({ write: () => new Promise<void>((resolve) => { releases.push(resolve); }), fail }, limits);
  const frame = (size = 10) => new Uint8Array(size);
  async function drain(count: number) { for (let index = 0; index < count; index++) { await settle(); releases.shift()!(); } await settle(); }
  return { writer, fail, frame, drain };
}

describe('update stream writer', () => {
  it('aborts once when a producer outruns the writer past the frame cap', async () => {
    const f = fixture({ maxFrames: 5, resumeFrames: 2, maxBytes: 1_000 });
    for (let index = 0; index < 8; index++) f.writer.enqueue(f.frame());
    expect(f.fail).toHaveBeenCalledExactlyOnceWith('send-queue-limit');
  });

  it('aborts when queued bytes pass the byte cap even with few frames', () => {
    const f = fixture({ maxFrames: 100, resumeFrames: 10, maxBytes: 100 });
    f.writer.enqueue(f.frame(60)); f.writer.enqueue(f.frame(60));
    expect(f.fail).toHaveBeenCalledExactlyOnceWith('send-queue-limit');
  });

  it('makes a bulk producer wait until the queue falls to the resume point', async () => {
    const f = fixture({ maxFrames: 100, resumeFrames: 3, maxBytes: 10_000 });
    for (let index = 0; index < 6; index++) f.writer.enqueue(f.frame());
    let released = false; void f.writer.drained().then(() => { released = true; });
    await f.drain(2); expect(released).toBe(false);
    await f.drain(1); expect(released).toBe(true);
    expect(f.fail).not.toHaveBeenCalled();
  });

  it('also waits for queued bytes to halve, not just frames', async () => {
    const f = fixture({ maxFrames: 100, resumeFrames: 10, maxBytes: 100 });
    f.writer.enqueue(f.frame(70));
    let released = false; void f.writer.drained().then(() => { released = true; });
    await settle(); expect(released).toBe(false);
    await f.drain(1); expect(released).toBe(true);
  });

  it('releases waiting producers and ignores later frames once closed', async () => {
    const f = fixture({ maxFrames: 100, resumeFrames: 0, maxBytes: 10_000 });
    f.writer.enqueue(f.frame());
    let released = false; void f.writer.drained().then(() => { released = true; });
    f.writer.close(); await settle();
    expect(released).toBe(true);
    f.writer.enqueue(f.frame()); expect(f.writer.queuedFrames).toBe(1);
  });

  it('fails the stream and frees waiting producers when a write is rejected', async () => {
    const fail = vi.fn();
    const writer = new UpdateStreamWriter({ write: async () => { throw new Error('socket closed'); }, fail });
    writer.enqueue(new Uint8Array(10));
    const waiting = writer.drained();
    await settle(); await waiting;
    expect(fail).toHaveBeenCalledExactlyOnceWith('send-failed', 'socket closed');
  });
});
