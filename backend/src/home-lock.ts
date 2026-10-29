import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

/** SSH-launched daemons set this: a second one on the same home would silently overwrite the first one's state. */
export const exclusiveHomeEnvironment = 'APP_EXCLUSIVE_HOME';

export class HomeInUseError extends Error {
  constructor(readonly pid: number | undefined) {
    super(`Another Korus session (pid ${pid ?? 'unknown'}) is already using this host's home. Close it, or remove the duplicate connection to this host, and retry.`);
  }
}

export type HomeLock = { release: () => Promise<void> };

export type HomeLockOptions = {
  pid?: number;
  /** How long to wait for a previous owner that is still shutting down. */
  waitMs?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

const lockFileName = 'daemon.lock';

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * One daemon owns a host's state at a time. Two daemons on one home each keep their own copy in memory
 * and overwrite each other's saves, so agents and teams vanish and reappear. A lock whose owner has
 * died is taken over; a live owner is waited for briefly (an app restart overlaps its predecessor) and
 * then refused.
 */
export async function acquireHomeLock(home: string, options: HomeLockOptions = {}): Promise<HomeLock> {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? processIsAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.waitMs ?? 8_000);
  const file = path.join(home, lockFileName);
  await mkdir(home, { recursive: true, mode: 0o700 });

  for (;;) {
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      await handle.close();
      return {
        release: async () => {
          if (await ownerOf(file) === pid) await rm(file, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const owner = await ownerOf(file);
    if (owner === undefined || !isAlive(owner)) {
      await rm(file, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new HomeInUseError(owner);
    await sleep(250);
  }
}

async function ownerOf(file: string): Promise<number | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    const pid = (value as { pid?: unknown })?.pid;
    return typeof pid === 'number' ? pid : undefined;
  } catch {
    return undefined;
  }
}
