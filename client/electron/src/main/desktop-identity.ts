import type { App } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { product } from '@workspace/core/product';

export function desktopIconPath(app: Pick<App, 'getAppPath' | 'isPackaged'>): string {
  return app.isPackaged
    ? path.join(path.dirname(app.getAppPath()), 'icon.png')
    : path.join(app.getAppPath(), 'assets', 'icon-dev.png');
}

export function configureDesktopIdentity(app: Pick<App, 'setName' | 'getAppPath' | 'getPath' | 'isPackaged'>, platform = process.platform, env = process.env, executable = process.execPath): void {
  app.setName(product.name);
  if (platform !== 'linux') return;
  const id = `${product.appId}${app.isPackaged ? '' : '.development'}`;
  const filename = `${id}.desktop`;
  const dataHome = env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
  const entry = path.join(dataHome, 'applications', filename);
  const systemDirectories = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  if (app.isPackaged && [dataHome, ...systemDirectories].some(directory => existsSync(path.join(directory, 'applications', filename)))) return;
  const icon = path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', `${id}.png`);
  mkdirSync(path.dirname(icon), { recursive: true });
  writeFileSync(icon, readFileSync(desktopIconPath(app)));
  mkdirSync(path.dirname(entry), { recursive: true });
  const quote = (value: string): string => `"${value.replace(/[%\\"`$]/g, character => character === '%' ? '%%' : character === '\\' ? '\\\\\\\\' : `\\\\${character}`)}"`;
  const command = [executable, ...(app.isPackaged ? [] : [app.getAppPath()])].map(quote).join(' ');
  writeFileSync(entry, [
    '[Desktop Entry]', 'Type=Application', `Name=${product.name}${app.isPackaged ? '' : ' (Development)'}`,
    `Exec=${command}`, `Icon=${icon}`, `StartupWMClass=${id}`, 'Terminal=false',
    ...(app.isPackaged ? [] : ['NoDisplay=true']), '',
  ].join('\n'));
}
