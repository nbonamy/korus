import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeScheduler } from '../runtime-scheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('RuntimeScheduler', () => {
  it('runs startup tasks immediately and repeats each task on its own cadence', async () => {
    vi.useFakeTimers();
    const frequent = vi.fn().mockResolvedValue(undefined);
    const occasional = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RuntimeScheduler();
    scheduler.register({ id: 'frequent', intervalMs: 1_000, runOnStart: true, run: frequent });
    scheduler.register({ id: 'occasional', intervalMs: 5_000, run: occasional });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(frequent).toHaveBeenCalledOnce();
    expect(occasional).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(frequent).toHaveBeenCalledTimes(6);
    expect(occasional).toHaveBeenCalledOnce();
  });

  it('does not overlap one task while other tasks continue independently', async () => {
    vi.useFakeTimers();
    let finishSlow: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { finishSlow = resolve; });
    const slow = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const fast = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RuntimeScheduler();
    scheduler.register({ id: 'slow', intervalMs: 1_000, runOnStart: true, run: slow });
    scheduler.register({ id: 'fast', intervalMs: 500, runOnStart: true, run: fast });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(slow).toHaveBeenCalledOnce();
    expect(fast).toHaveBeenCalledTimes(5);

    finishSlow();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('isolates task failures and schedules the next run', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = new RuntimeScheduler({ onError });
    scheduler.register({ id: 'github', intervalMs: 1_000, runOnStart: true, run });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith('github', expect.objectContaining({ message: 'offline' }));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stops future runs and treats repeated lifecycle calls as idempotent', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RuntimeScheduler();
    scheduler.register({ id: 'task', intervalMs: 1_000, run: run });

    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledOnce();

    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledOnce();
  });

  it('rejects invalid or late registrations', () => {
    const scheduler = new RuntimeScheduler();
    scheduler.register({ id: 'task', intervalMs: 1_000, run: async () => undefined });

    expect(() => scheduler.register({ id: 'task', intervalMs: 1_000, run: async () => undefined }))
      .toThrow('Runtime task is already registered: task');
    expect(() => new RuntimeScheduler().register({ id: '', intervalMs: 1_000, run: async () => undefined }))
      .toThrow('Runtime task id is required.');
    expect(() => new RuntimeScheduler().register({ id: 'invalid', intervalMs: 0, run: async () => undefined }))
      .toThrow('Runtime task interval must be positive: invalid');

    scheduler.start();
    expect(() => scheduler.register({ id: 'late', intervalMs: 1_000, run: async () => undefined }))
      .toThrow('Register runtime tasks before starting the scheduler.');
    scheduler.stop();
  });
});
