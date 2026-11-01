import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileRemoteSnapshotCache } from '../connections/remote-snapshot-cache';
import { createRemoteAgent, createRemoteTeamSnapshot } from './server-test-fixtures';

describe('file remote snapshot cache', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'remote-snapshot-cache-'));
    file = path.join(directory, 'remote-snapshots.json');
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('restores what an earlier run saved and forgets removed hosts', async () => {
    const agent = createRemoteAgent();
    const first = createFileRemoteSnapshotCache(file);
    first.save('connection-a', createRemoteTeamSnapshot([agent]));
    first.save('connection-b', createRemoteTeamSnapshot([]));
    first.save('connection-b', null);
    await first.flush();

    const restored = createFileRemoteSnapshotCache(file).load();

    expect([...restored.keys()]).toStrictEqual(['connection-a']);
    expect(restored.get('connection-a')!.agents.map(candidate => candidate.id)).toStrictEqual([agent.id]);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('starts empty when the file is missing or damaged', async () => {
    expect(createFileRemoteSnapshotCache(file).load().size).toBe(0);
    await writeFile(file, '{not json');
    expect(createFileRemoteSnapshotCache(file).load().size).toBe(0);
    await writeFile(file, JSON.stringify({ version: 1, snapshots: { 'connection-a': { nope: true } } }));
    expect(createFileRemoteSnapshotCache(file).load().size).toBe(0);
    expect(await readFile(file, 'utf8')).toContain('nope');
  });
});
