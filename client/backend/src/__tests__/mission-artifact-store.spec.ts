import { product } from '@workspace/core/product';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileMissionArtifactStore } from '../mission-artifact-store';

describe('FileMissionArtifactStore', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

  it(`writes canonical stage artifacts under the ${product.name}-owned mission home and reads them back`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'app-mission-artifacts-'));
    roots.push(root);
    const store = new FileMissionArtifactStore(async missionId => path.join(root, missionId));

    await expect(store.write('mission-123', 'requirements', '# Requirements\nBuild billing.')).resolves.toEqual({ size: 29 });
    await expect(store.read('mission-123', 'requirements')).resolves.toBe('# Requirements\nBuild billing.');
    await expect(readFile(path.join(root, 'mission-123', 'artifacts', 'requirements.md'), 'utf8'))
      .resolves.toBe('# Requirements\nBuild billing.');
  });

  it('rejects traversal, unknown stages, empty content, and oversized artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'app-mission-artifacts-'));
    roots.push(root);
    const store = new FileMissionArtifactStore(async missionId => path.join(root, missionId));

    await expect(store.write('../outside', 'requirements', 'x')).rejects.toThrow('path');
    await expect(store.write('mission-123', 'unknown' as 'requirements', 'x')).rejects.toThrow('path');
    await expect(store.write('mission-123', 'requirements', ' ')).rejects.toThrow('between');
    await expect(store.write('mission-123', 'requirements', 'x'.repeat(500_001))).rejects.toThrow('between');
  });
});
