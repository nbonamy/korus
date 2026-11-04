import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { CliError, fileExists, redact, record, type CliContext, type CliOptions } from './context';

async function logFiles(context: CliContext, options: CliOptions): Promise<string[]> {
  const files: string[] = [];
  for (const directory of [path.join(options.home, 'logs'), ...(context.platform === 'darwin' ? [path.join(context.userHome, 'Library', 'Logs', product.name)] : [])]) {
    try { for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:daemon|main)(?:[.\w-]*)\.log$/u.test(entry.name)) files.push(path.join(directory, entry.name));
    } } catch { /* A fresh install has no logs. */ }
  }
  return files.sort().slice(-20);
}
export async function tail(file: string, limit = 1024 * 1024): Promise<string[]> {
  const handle = await open(file, 'r');
  try {
    const size = (await handle.stat()).size; const start = Math.max(0, size - limit);
    const bytes = Buffer.alloc(Math.min(size, limit)); const read = await handle.read(bytes, 0, bytes.length, start);
    const lines = bytes.subarray(0, read.bytesRead).toString('utf8').split('\n').slice(0, -1);
    return (start ? lines.slice(1) : lines).filter(Boolean);
  } finally { await handle.close(); }
}
const privateFields = /^(?:content|prompt|arguments|params|request|response|input|output|headers|env|credentials|authorization|.*token.*|.*password.*|.*secret.*|api.?key)$/iu;
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.test(key)).map(([key, child]) => [key, scrub(child)]));
}
export async function readLogs(context: CliContext, options: CliOptions) {
  const entries: { file: string; time?: string; text: string }[] = [];
  for (const file of await logFiles(context, options)) {
    let lines: string[];
    try { lines = await tail(file); } catch { continue; }
    for (const line of lines) {
      let value: unknown; try { value = JSON.parse(line); } catch { value = undefined; }
      const time = record(value) && typeof value.time === 'string' ? value.time : undefined;
      if (options.since && (!time || !Number.isFinite(Date.parse(time)) || Date.parse(time) < options.since)) continue;
      if (options.agent && (!record(value) || ![value.agentId, value.from, value.to].includes(options.agent.slice(options.agent.lastIndexOf(':') + 1).trim()))) continue;
      entries.push({ file: path.basename(file), ...(time ? { time } : {}), text: redact(record(value) ? JSON.stringify(scrub(value)) : line, context, options.home) });
    }
  }
  entries.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  return entries.slice(-options.lines);
}
export async function followLogs(context: CliContext, options: CliOptions): Promise<void> {
  const { watch } = await import('node:fs');
  const { once } = await import('node:events');
  const activeFiles = async () => (await logFiles(context, options)).filter(file => /^(?:daemon|main)(?:\.(?:out|err))?\.log$/u.test(path.basename(file)));
  const initial = await activeFiles();
  const directories = [...new Set(initial.map(file => path.dirname(file)))];
  const daemonLogs = path.join(options.home, 'logs');
  if (await fileExists(daemonLogs) && !directories.includes(daemonLogs)) directories.push(daemonLogs);
  if (!directories.length) throw new CliError('No log directories exist yet. No state was created.');
  const cursors = new Map<string, { offset: number; size: number; inode: number }>();
  for (const file of initial) {
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat(), start = Math.max(0, info.size - 1024 * 1024);
      const buffer = Buffer.alloc(info.size - start); const read = await handle.read(buffer, 0, buffer.length, start);
      const newline = buffer.subarray(0, read.bytesRead).lastIndexOf(10);
      cursors.set(file, { offset: newline < 0 ? 0 : start + newline + 1, size: info.size, inode: info.ino });
    } finally { await handle.close(); }
  }
  const watchers = directories.map(directory => watch(directory));
  let pending = Promise.resolve();
  const update = () => {
    pending = pending.then(async () => {
      for (const file of await activeFiles()) {
        const handle = await open(file, 'r');
        try {
          const info = await handle.stat(); const previous = cursors.get(file);
          if (previous?.inode === info.ino && previous.size === info.size) continue;
          const offset = !previous || previous.inode !== info.ino || info.size < previous.size ? 0 : previous.offset;
          const start = Math.max(offset, info.size - 1024 * 1024);
          const buffer = Buffer.alloc(info.size - start); const read = await handle.read(buffer, 0, buffer.length, start);
          const bytes = buffer.subarray(0, read.bytesRead), newline = bytes.lastIndexOf(10);
          cursors.set(file, { offset: newline < 0 ? offset : start + newline + 1, size: info.size, inode: info.ino });
          if (newline < 0) continue;
          const lines = bytes.subarray(0, newline).toString('utf8').split('\n');
          // Never emit a partial JSON row: its credential fields cannot be reliably redacted.
          for (const line of (start > offset ? lines.slice(1) : lines).filter(Boolean)) {
            let row: unknown; try { row = JSON.parse(line); } catch { row = undefined; }
            const agent = options.agent?.slice(options.agent.lastIndexOf(':') + 1).trim();
            if (agent && (!record(row) || ![row.agentId, row.from, row.to].includes(agent))) continue;
            context.out(redact(record(row) ? JSON.stringify(scrub(row)) : line, context, options.home));
          }
        } finally { await handle.close(); }
      }
    }).catch(() => { context.err('A log changed during rotation; continuing.'); });
  };
  for (const watcher of watchers) watcher.on('change', update);
  const closed = Promise.all(watchers.map(watcher => once(watcher, 'close')));
  const stop = () => { for (const watcher of watchers) watcher.close(); };
  if (context.signal) context.signal.addEventListener('abort', stop, { once: true });
  else { process.once('SIGINT', stop); process.once('SIGTERM', stop); }
  context.out(options.json ? JSON.stringify({ event: 'following' }) : 'Following logs. Press Ctrl+C to stop.');
  if (context.signal?.aborted) stop();
  try { await closed; await pending; } finally {
    context.signal?.removeEventListener('abort', stop); process.off('SIGINT', stop); process.off('SIGTERM', stop); stop();
  }
}
