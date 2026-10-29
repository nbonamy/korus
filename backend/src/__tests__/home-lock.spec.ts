import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireHomeLock, HomeInUseError } from '../home-lock';

const homes: string[] = [];
const newHome = async () => { const home = await mkdtemp(path.join(os.tmpdir(), 'home-lock-')); homes.push(home); return home; };
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

describe('home lock', () => {
  it('lets one daemon own the home and records who', async () => {
    const home = await newHome();
    const lock = await acquireHomeLock(home, { pid: 111 });
    expect(JSON.parse(await readFile(path.join(home, 'daemon.lock'), 'utf8'))).toMatchObject({ pid: 111 });
    await lock.release();
    await expect(readFile(path.join(home, 'daemon.lock'), 'utf8')).rejects.toThrow();
  });

  it('refuses a second daemon while the first is alive, after waiting for it to finish', async () => {
    const home = await newHome();
    await acquireHomeLock(home, { pid: 111 });
    const sleep = vi.fn(async () => undefined);
    await expect(acquireHomeLock(home, { pid: 222, isAlive: () => true, waitMs: 0, sleep })).rejects.toBeInstanceOf(HomeInUseError);
    await expect(acquireHomeLock(home, { pid: 222, isAlive: () => true, waitMs: 0, sleep })).rejects.toThrow('pid 111');
  });

  it('takes the home over once the previous owner is gone while it waits', async () => {
    const home = await newHome();
    await acquireHomeLock(home, { pid: 111 });
    let alive = true;
    const sleep = vi.fn(async () => { alive = false; });
    const lock = await acquireHomeLock(home, { pid: 222, isAlive: () => alive, waitMs: 10_000, sleep });
    expect(sleep).toHaveBeenCalled();
    expect(JSON.parse(await readFile(path.join(home, 'daemon.lock'), 'utf8'))).toMatchObject({ pid: 222 });
    await lock.release();
  });

  it('replaces a stale or unreadable lock left by a crashed daemon', async () => {
    const home = await newHome();
    await writeFile(path.join(home, 'daemon.lock'), 'not json');
    await acquireHomeLock(home, { pid: 333 });
    await writeFile(path.join(home, 'daemon.lock'), JSON.stringify({ pid: 999_999 }));
    await expect(acquireHomeLock(home, { pid: 444, isAlive: () => false })).resolves.toBeDefined();
  });

  it('never releases a lock another daemon took over', async () => {
    const home = await newHome();
    const first = await acquireHomeLock(home, { pid: 111 });
    await writeFile(path.join(home, 'daemon.lock'), JSON.stringify({ pid: 222 }));
    await first.release();
    expect(JSON.parse(await readFile(path.join(home, 'daemon.lock'), 'utf8'))).toMatchObject({ pid: 222 });
  });
});
