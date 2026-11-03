import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePerformanceProfile, type ProfilerDebugger } from '../performance-profile';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

function fakeDebugger(options: { attached?: boolean; failOn?: string } = {}) {
  const calls: string[] = [];
  const listeners = new Set<(event: unknown, method: string, params: { chunk?: string }) => void>();
  let attached = options.attached ?? false;
  const debuggerLike: ProfilerDebugger = {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true; calls.push('attach'); }),
    detach: vi.fn(() => { attached = false; calls.push('detach'); }),
    sendCommand: vi.fn(async (method: string) => {
      calls.push(method);
      if (method === options.failOn) throw new Error(`${method} failed`);
      if (method === 'Profiler.stop') return { profile: { nodes: [{ id: 1 }], samples: [1], timeDeltas: [10] } };
      if (method === 'HeapProfiler.takeHeapSnapshot') for (const chunk of ['{"snap', 'shot":1}']) listeners.forEach(listener => listener({}, 'HeapProfiler.addHeapSnapshotChunk', { chunk }));
      return {};
    }),
    on: vi.fn((_event: 'message', listener: (event: unknown, method: string, params: { chunk?: string }) => void) => { listeners.add(listener); }),
    removeListener: vi.fn((_event: 'message', listener: (event: unknown, method: string, params: { chunk?: string }) => void) => { listeners.delete(listener); }),
  };
  return { debuggerLike, calls, listeners };
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'app-profile-')); directories.push(directory);
  return directory;
}
const prefix = product.name.toLowerCase();
const now = () => new Date('2026-11-02T22:40:05.000Z');

describe('capturePerformanceProfile', () => {
  it('records a CPU profile and the process metrics around it, then detaches', async () => {
    const directory = await setup();
    const { debuggerLike, calls } = fakeDebugger();
    const sleep = vi.fn(async () => { calls.push('sleep'); });
    const metrics = vi.fn().mockReturnValueOnce({ cpu: 'before' }).mockReturnValueOnce({ cpu: 'after' });
    const result = await capturePerformanceProfile({ debugger: debuggerLike, directory, durationMs: 10_000, includeHeapSnapshot: false, now, sleep, metrics });
    expect(calls).toStrictEqual(['attach', 'Profiler.enable', 'Profiler.start', 'sleep', 'Profiler.stop', 'Profiler.disable', 'detach']);
    expect(sleep).toHaveBeenCalledWith(10_000);
    expect(result.heapSnapshotPath).toBeUndefined();
    expect((await readdir(directory)).sort()).toStrictEqual([`${prefix}-cpu-2026-11-02T22-40-05.cpuprofile`, `${prefix}-metrics-2026-11-02T22-40-05.json`]);
    expect(JSON.parse(await readFile(result.cpuProfilePath, 'utf8')).samples).toStrictEqual([1]);
    expect(JSON.parse(await readFile(result.metricsPath!, 'utf8'))).toStrictEqual({ capturedAt: '2026-11-02T22:40:05.000Z', durationMs: 10_000, before: { cpu: 'before' }, after: { cpu: 'after' } });
  });

  it('streams a heap snapshot to disk when asked', async () => {
    const directory = await setup();
    const { debuggerLike, calls, listeners } = fakeDebugger();
    const result = await capturePerformanceProfile({ debugger: debuggerLike, directory, durationMs: 1, includeHeapSnapshot: true, now, sleep: async () => undefined });
    expect(calls).toContain('HeapProfiler.takeHeapSnapshot');
    expect(await readFile(result.heapSnapshotPath!, 'utf8')).toBe('{"snapshot":1}');
    expect(listeners.size).toBe(0);
  });

  it('leaves a debugger someone else attached in place', async () => {
    const directory = await setup();
    const { debuggerLike, calls } = fakeDebugger({ attached: true });
    await capturePerformanceProfile({ debugger: debuggerLike, directory, durationMs: 1, includeHeapSnapshot: false, now, sleep: async () => undefined });
    expect(calls).not.toContain('attach');
    expect(calls).not.toContain('detach');
  });

  it('detaches and reports the failure when the profiler errors', async () => {
    const directory = await setup();
    const { debuggerLike, calls } = fakeDebugger({ failOn: 'Profiler.start' });
    await expect(capturePerformanceProfile({ debugger: debuggerLike, directory, durationMs: 1, includeHeapSnapshot: false, now, sleep: async () => undefined })).rejects.toThrow('Profiler.start failed');
    expect(calls.at(-1)).toBe('detach');
  });
});
