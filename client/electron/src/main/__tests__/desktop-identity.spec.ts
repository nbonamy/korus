import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { product } from '@workspace/core/product';
import { configureDesktopIdentity, desktopIconPath } from '../desktop-identity';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

function fixture(packaged = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-identity-'));
  directories.push(root);
  const appPath = path.join(root, 'app with spaces');
  const app = { setName: vi.fn(), getAppPath: () => appPath, getPath: () => root, isPackaged: packaged };
  const sourceIcon = packaged ? path.join(root, 'icon.png') : path.join(appPath, 'assets', 'icon-dev.png');
  mkdirSync(path.dirname(sourceIcon), { recursive: true });
  writeFileSync(sourceIcon, packaged ? 'product icon' : 'development icon');
  if (!packaged) writeFileSync(path.join(appPath, 'assets', 'icon.png'), 'product icon');
  const dataHome = path.join(root, 'data');
  const env = { XDG_DATA_HOME: dataHome, XDG_DATA_DIRS: path.join(root, 'system') };
  return { app, appPath, dataHome, env };
}

describe('Linux desktop identity', () => {
  it('resolves packaged icons outside the application archive', () => {
    expect(desktopIconPath({ isPackaged: true, getAppPath: () => '/opt/app/resources/app.asar' })).toBe('/opt/app/resources/icon.png');
  });
  it.each([false, true])('registers a matching name, icon, and safely quoted launcher (packaged=%s)', (packaged) => {
    const { app, appPath, dataHome, env } = fixture(packaged);
    configureDesktopIdentity(app, 'linux', env, '/runtime with spaces/electron');
    const id = `${product.appId}${packaged ? '' : '.development'}`;
    expect(app.setName).toHaveBeenCalledWith(product.name);
    const entry = readFileSync(path.join(dataHome, 'applications', `${id}.desktop`), 'utf8');
    expect(entry).toContain(`Name=${product.name}${packaged ? '' : ' (Development)'}\n`);
    expect(entry).toContain(`StartupWMClass=${id}\n`);
    expect(entry).toContain(`Exec="/runtime with spaces/electron"${packaged ? '' : ` "${appPath}"`}\n`);
    const icon = path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', `${id}.png`);
    expect(entry).toContain(`Icon=${icon}\n`);
    expect(readFileSync(icon, 'utf8')).toBe(packaged ? 'product icon' : 'development icon');
  });

  it('preserves desktop entries installed by a package manager', () => {
    const { app, env, dataHome } = fixture(true);
    const directory = path.join(env.XDG_DATA_DIRS, 'applications');
    mkdirSync(directory, { recursive: true });
    const entry = path.join(directory, `${product.appId}.desktop`);
    writeFileSync(entry, 'installed entry');
    configureDesktopIdentity(app, 'linux', env);
    expect(readFileSync(entry, 'utf8')).toBe('installed entry');
    expect(() => readFileSync(path.join(dataHome, 'applications', `${product.appId}.desktop`))).toThrow();
  });

  it.each(['darwin', 'win32'] as const)('only sets the application name on %s', (platform) => {
    const { app, env } = fixture();
    configureDesktopIdentity(app, platform, env);
    expect(app.setName).toHaveBeenCalledWith(product.name);
  });
});
