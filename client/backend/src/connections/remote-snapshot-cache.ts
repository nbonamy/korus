import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSnapshot } from '@workspace/core/contracts';
import { decodeAppSnapshot } from '@workspace/core/snapshot-guards';
import type { RemoteSnapshotCache } from './remote-team-service';

const writeDelayMs = 500;

/** Remote agents of the last session, kept in one private file next to the roster. */
export function createFileRemoteSnapshotCache(file: string): RemoteSnapshotCache & { flush: () => Promise<void> } {
  const entries = new Map<string, AppSnapshot>();
  let loaded = false;
  let timer: NodeJS.Timeout | undefined;
  let writing: Promise<void> = Promise.resolve();

  function load(): Map<string, AppSnapshot> {
    if (!loaded) {
      loaded = true;
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        const stored = parsed && typeof parsed === 'object' ? (parsed as { snapshots?: unknown }).snapshots : undefined;
        for (const [connectionId, value] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
          const decoded = decodeAppSnapshot(value);
          if (decoded) entries.set(connectionId, decoded.value);
        }
      } catch {
        // A missing or damaged cache only means the projects reappear once the host answers.
      }
    }
    return new Map(entries);
  }

  async function write(): Promise<void> {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify({ version: 1, snapshots: Object.fromEntries(entries) }), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, file);
    } catch {
      await unlink(temporary).catch(() => undefined);
    }
  }

  function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    writing = writing.then(write);
    return writing;
  }

  return {
    load,
    save(connectionId, snapshot) {
      load();
      if (snapshot) entries.set(connectionId, snapshot);
      else entries.delete(connectionId);
      timer ??= setTimeout(() => { void flush(); }, writeDelayMs).unref();
    },
    flush,
  };
}
