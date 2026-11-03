import { product } from '@workspace/core/product';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

type DebuggerMessage = (event: unknown, method: string, params: { chunk?: string }) => void;
/** The slice of Electron's webContents.debugger used for profiling. */
export type ProfilerDebugger = {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: 'message', listener: DebuggerMessage): unknown;
  removeListener(event: 'message', listener: DebuggerMessage): unknown;
};

export type PerformanceCaptureOptions = {
  debugger: ProfilerDebugger;
  directory: string;
  durationMs: number;
  includeHeapSnapshot: boolean;
  /** Process CPU and memory figures, read before and after the recording. */
  metrics?: () => unknown;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type PerformanceCaptureResult = {
  directory: string;
  cpuProfilePath: string;
  metricsPath?: string;
  heapSnapshotPath?: string;
};

/**
 * Records a V8 CPU profile (and optionally a heap snapshot) of the renderer through the debugger protocol,
 * so slowness can be diagnosed from release builds where DevTools is unavailable.
 * The CPU profile opens in Chrome DevTools or speedscope; the heap snapshot in DevTools Memory.
 */
export async function capturePerformanceProfile(options: PerformanceCaptureOptions): Promise<PerformanceCaptureResult> {
  const { debugger: session, directory } = options;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const prefix = product.name.toLowerCase();
  const stamp = now().toISOString().slice(0, 19).replaceAll(':', '-');
  await mkdir(directory, { recursive: true });
  const attachedHere = !session.isAttached();
  if (attachedHere) session.attach('1.3');
  try {
    const before = options.metrics?.();
    await session.sendCommand('Profiler.enable');
    await session.sendCommand('Profiler.start');
    await sleep(options.durationMs);
    const { profile } = await session.sendCommand('Profiler.stop') as { profile: unknown };
    await session.sendCommand('Profiler.disable');
    const cpuProfilePath = path.join(directory, `${prefix}-cpu-${stamp}.cpuprofile`);
    await writeFile(cpuProfilePath, JSON.stringify(profile));
    const result: PerformanceCaptureResult = { directory, cpuProfilePath };
    if (options.metrics) {
      result.metricsPath = path.join(directory, `${prefix}-metrics-${stamp}.json`);
      await writeFile(result.metricsPath, JSON.stringify({ capturedAt: now().toISOString(), durationMs: options.durationMs, before, after: options.metrics() }, null, 2));
    }
    if (options.includeHeapSnapshot) {
      result.heapSnapshotPath = path.join(directory, `${prefix}-heap-${stamp}.heapsnapshot`);
      await writeHeapSnapshot(session, result.heapSnapshotPath);
    }
    return result;
  } finally {
    if (attachedHere) session.detach();
  }
}

/** Chunks go straight to disk: a snapshot of a multi-gigabyte renderer must not be held in memory. */
async function writeHeapSnapshot(session: ProfilerDebugger, file: string): Promise<void> {
  const stream = createWriteStream(file);
  const onMessage: DebuggerMessage = (_event, method, params) => {
    if (method === 'HeapProfiler.addHeapSnapshotChunk' && params.chunk !== undefined) stream.write(params.chunk);
  };
  session.on('message', onMessage);
  try {
    await session.sendCommand('HeapProfiler.enable');
    await session.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    await session.sendCommand('HeapProfiler.disable');
  } finally {
    session.removeListener('message', onMessage);
    stream.end();
    await once(stream, 'finish');
  }
}
