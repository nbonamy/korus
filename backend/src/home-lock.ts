import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

/** SSH-launched daemons must exclusively own the host's persisted state. */
export const exclusiveHomeEnvironment = 'APP_EXCLUSIVE_HOME';

export class HomeInUseError extends Error {
  readonly pid: number | undefined;
  constructor(pid: number | undefined) {
    super(`Another Korus session (pid ${pid ?? 'unknown'}) is already using this host's home. Close it, or remove the duplicate connection to this host, and retry.`);
    this.pid = pid;
  }
}

export type HomeLock = { release: () => Promise<void> };
export type HomeLockOptions = {
  pid?: number;
  /** How long to wait for a previous owner that is still shutting down. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * SQLite holds the OS lock for the lifetime of the daemon. The lock database is
 * never unlinked: crashed owners release their kernel locks automatically, with
 * no stale-file takeover race. daemon.lock is diagnostic metadata only.
 */
export async function acquireHomeLock(home: string, options: HomeLockOptions = {}): Promise<HomeLock> {
  const pid = options.pid ?? process.pid;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.waitMs ?? 8_000);
  const file = path.join(home, 'daemon.lock');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const databaseFile = path.join(home, 'daemon-lock.sqlite');
  const handle = await open(databaseFile, 'a', 0o600);
  await handle.close();
  const database = new DatabaseSync(databaseFile);
  try {
    for (;;) {
      try {
        database.exec('BEGIN EXCLUSIVE');
        break;
      } catch (error) {
        if ((error as { errcode?: number }).errcode !== 5) throw error;
        if (Date.now() >= deadline) throw new HomeInUseError(await ownerOf(file));
        await sleep(250);
      }
    }
    await writeFile(file, JSON.stringify({ pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  } catch (error) {
    database.close();
    throw error;
  }
  let released = false;
  return { release: async () => {
    if (released) return;
    released = true;
    try {
      if (await ownerOf(file) === pid) await rm(file, { force: true });
    } finally { database.close(); }
  } };
}

async function ownerOf(file: string): Promise<number | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    const pid = (value as { pid?: unknown })?.pid;
    return typeof pid === 'number' ? pid : undefined;
  } catch { return undefined; }
}
