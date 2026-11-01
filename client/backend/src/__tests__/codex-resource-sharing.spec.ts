import { product } from '@workspace/core/product';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCodexResourceSharingStatus, initializeCodexResourceSharing, reconcileCodexResourceSharing, setCodexResourceSharing, type CodexResourceSharingPaths } from '../codex-resource-sharing';

describe('Codex resource sharing', () => {
  let root: string;
  let paths: CodexResourceSharingPaths;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'agent-workspace-resource-sharing-'));
    paths = {
      appCodexHome: path.join(root, product.homeDirectory, 'codex-home'),
      userCodexHome: path.join(root, '.codex'),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(`replaces isolated ${product.name} resources with links to the user Codex home`, async () => {
    await writeFile(path.join(await directory('appCodexHome', 'skills'), 'app-only.md'), 'old');

    await reconcileCodexResourceSharing(true, paths);

    await expectLink('skills');
    await expectLink('plugins');
    await expect(readFile(path.join(paths.appCodexHome, 'skills', 'app-only.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves existing isolated resources untouched and reports a migration', async () => {
    const existingSkill = path.join(await directory('appCodexHome', 'skills'), 'app-only.md');
    await writeFile(existingSkill, 'keep until the user decides');

    await initializeCodexResourceSharing(true, paths);

    expect(await readFile(existingSkill, 'utf8')).toBe('keep until the user decides');
    expect(await getCodexResourceSharingStatus(true, paths)).toStrictEqual({
      enabled: true,
      migrationRequired: true,
    });
  });

  it('creates shared links automatically for a fresh Codex home', async () => {
    await initializeCodexResourceSharing(true, paths);

    await expectLink('skills');
    await expectLink('plugins');
    expect(await getCodexResourceSharingStatus(true, paths)).toStrictEqual({
      enabled: true,
      migrationRequired: false,
    });
  });

  it('keeps shared resources live across repeated startup reconciliation', async () => {
    await initializeCodexResourceSharing(true, paths);
    await writeFile(path.join(paths.userCodexHome, 'skills', 'shared.md'), 'first');
    expect(await readFile(path.join(paths.appCodexHome, 'skills', 'shared.md'), 'utf8')).toBe('first');

    await initializeCodexResourceSharing(true, paths);
    await writeFile(path.join(paths.appCodexHome, 'skills', 'shared.md'), 'updated');
    expect(await readFile(path.join(paths.userCodexHome, 'skills', 'shared.md'), 'utf8')).toBe('updated');
    expect(await getCodexResourceSharingStatus(true, paths)).toStrictEqual({ enabled: true, migrationRequired: false });
  });

  it('creates fresh isolated directories when sharing is turned off', async () => {
    await reconcileCodexResourceSharing(true, paths);
    await writeFile(path.join(paths.userCodexHome, 'skills', 'shared.md'), 'shared');

    await setCodexResourceSharing({ enabled: false, mode: 'fresh' }, paths);

    expect((await lstat(path.join(paths.appCodexHome, 'skills'))).isDirectory()).toBe(true);
    expect((await lstat(path.join(paths.appCodexHome, 'skills'))).isSymbolicLink()).toBe(false);
    await expect(readFile(path.join(paths.appCodexHome, 'skills', 'shared.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(paths.userCodexHome, 'skills', 'shared.md'), 'utf8')).toBe('shared');
  });

  it(`copies user skills and plugins into isolated ${product.name} directories`, async () => {
    await writeFile(path.join(await directory('userCodexHome', 'skills'), 'skill.md'), 'skill');
    await writeFile(path.join(await directory('userCodexHome', 'plugins'), 'plugin.json'), 'plugin');
    await reconcileCodexResourceSharing(true, paths);

    await setCodexResourceSharing({ enabled: false, mode: 'copy' }, paths);

    expect(await readFile(path.join(paths.appCodexHome, 'skills', 'skill.md'), 'utf8')).toBe('skill');
    expect(await readFile(path.join(paths.appCodexHome, 'plugins', 'plugin.json'), 'utf8')).toBe('plugin');
    expect((await lstat(path.join(paths.appCodexHome, 'skills'))).isSymbolicLink()).toBe(false);
  });

  it('preserves existing isolated resources during startup reconciliation', async () => {
    await writeFile(path.join(await directory('appCodexHome', 'plugins'), 'app.json'), 'keep');

    await reconcileCodexResourceSharing(false, paths);

    expect(await readFile(path.join(paths.appCodexHome, 'plugins', 'app.json'), 'utf8')).toBe('keep');
  });

  async function directory(home: keyof CodexResourceSharingPaths, name: 'skills' | 'plugins'): Promise<string> {
    const directoryPath = path.join(paths[home], name);
    await mkdir(directoryPath, { recursive: true });
    return directoryPath;
  }

  async function expectLink(name: 'skills' | 'plugins'): Promise<void> {
    const linkPath = path.join(paths.appCodexHome, name);
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(path.resolve(path.dirname(linkPath), await readlink(linkPath))).toBe(path.join(paths.userCodexHome, name));
  }
});
