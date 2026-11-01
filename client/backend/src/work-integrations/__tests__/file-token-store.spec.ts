import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileWorkIntegrationTokenStore } from '../file-token-store';

describe('FileWorkIntegrationTokenStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-backend-token-store-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { force: true, recursive: true });
  });

  it('persists access tokens as plain provider token JSON', async () => {
    const filePath = path.join(tmpDir, 'provider-tokens.json');
    const store = new FileWorkIntegrationTokenStore(filePath);

    await store.set({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      scope: 'repo read:user',
      expiresAt: '2026-06-11T20:00:00.000Z',
      refreshToken: 'ghr_secret',
      refreshTokenExpiresAt: '2026-12-12T12:00:00.000Z',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-11T12:00:00.000Z',
    });

    const rawFile = await readFile(filePath, 'utf8');
    expect(rawFile).toContain('"accessToken": "gho_secret"');
    expect(rawFile).toContain('"refreshToken": "ghr_secret"');
    expect(rawFile).not.toContain('encryptedAccessToken');
    await expect(store.get('github')).resolves.toStrictEqual({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      scope: 'repo read:user',
      expiresAt: '2026-06-11T20:00:00.000Z',
      refreshToken: 'ghr_secret',
      refreshTokenExpiresAt: '2026-12-12T12:00:00.000Z',
      accountLabel: 'nbonamy',
      connectedAt: '2026-06-11T12:00:00.000Z',
    });
  });

  it('deletes persisted provider tokens', async () => {
    const store = new FileWorkIntegrationTokenStore(path.join(tmpDir, 'provider-tokens.json'));

    await store.set({
      provider: 'github',
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      connectedAt: '2026-06-11T12:00:00.000Z',
    });

    await store.delete('github');

    await expect(store.get('github')).resolves.toBeNull();
  });

  it('serializes overlapping token updates so the latest operation wins cleanly', async () => {
    const store = new FileWorkIntegrationTokenStore(path.join(tmpDir, 'provider-tokens.json'));

    const first = store.set({
      provider: 'github',
      accessToken: 'gho_first',
      tokenType: 'bearer',
      connectedAt: '2026-06-11T12:00:00.000Z',
    });
    const second = store.set({
      provider: 'github',
      accessToken: 'gho_second',
      tokenType: 'bearer',
      connectedAt: '2026-06-11T12:01:00.000Z',
    });
    await Promise.all([first, second]);

    await expect(store.get('github')).resolves.toMatchObject({
      accessToken: 'gho_second',
      connectedAt: '2026-06-11T12:01:00.000Z',
    });
  });
});
