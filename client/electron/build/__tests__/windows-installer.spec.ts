// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { product } from '@workspace/core/product';
import config from '../../forge.config';
import desktopPackage from '../../package.json';

it('makes a product-named Windows setup and update artifacts from the packaged app', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'app-installer-'));
  const winstaller = createRequire(import.meta.url)('electron-winstaller');
  const createInstaller = vi.spyOn(winstaller, 'createWindowsInstaller').mockResolvedValue(undefined);
  try {
    const dir = path.join(root, 'app');
    await mkdir(dir);
    const maker = config.makers?.find(maker => maker instanceof MakerSquirrel) as MakerSquirrel;
    expect(maker).toBeDefined();
    expect(config.makers?.filter(maker => maker instanceof MakerSquirrel)).toHaveLength(1);
    expect(maker.platforms).toStrictEqual(['win32']);
    const zip = config.makers?.find(maker => maker instanceof MakerZIP) as MakerZIP;
    expect(zip.platforms).toContain('win32');
    await maker.prepareConfig('x64');
    const artifacts = await maker.make({
      dir, makeDir: path.join(root, 'make'), targetArch: 'x64', targetPlatform: 'win32',
      packageJSON: { name: '@workspace/electron', version: '1.2.3' }, appName: product.name, forgeConfig: config,
    });
    expect(createInstaller).toHaveBeenCalledOnce();
    expect(createInstaller.mock.calls[0][0]).toMatchObject({
      name: product.slug, title: product.name, authors: product.name,
      exe: `${product.name}.exe`, setupExe: `${product.slug}-${desktopPackage.version}-${process.arch}-setup.exe`, noMsi: true,
    });
    expect(artifacts.map(file => path.basename(file))).toStrictEqual([
      'RELEASES', `${product.slug}-${desktopPackage.version}-${process.arch}-setup.exe`, `${product.slug}-1.2.3-full.nupkg`,
    ]);
  } finally {
    createInstaller.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
