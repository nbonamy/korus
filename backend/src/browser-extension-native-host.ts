import { access, constants, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** Native host registration is installed by the desktop vendor, never by Korus. */
export async function resolveExtensionNativeHost(
  extensionId: string,
  host: string,
  directories?: readonly string[],
): Promise<{ name: string; path: string }> {
  const home = homedir();
  const roots =
    directories ??
    (process.platform === 'darwin'
      ? [
          path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'),
          path.join(home, 'Library/Application Support/Chromium/NativeMessagingHosts'),
          '/Library/Google/Chrome/NativeMessagingHosts',
          '/Library/Application Support/Chromium/NativeMessagingHosts',
        ]
      : process.platform === 'linux'
        ? [
            path.join(home, '.config/google-chrome/NativeMessagingHosts'),
            path.join(home, '.config/chromium/NativeMessagingHosts'),
            '/etc/opt/chrome/native-messaging-hosts',
            '/etc/chromium/native-messaging-hosts',
          ]
        : []);
  if (!/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/.test(host)) throw new Error('Invalid native host name.');
  for (const root of roots) {
    let source: string;
    try {
      const filename = path.join(root, `${host}.json`);
      if ((await stat(filename)).size > 64 * 1024) throw new Error('Native host registration is too large.');
      source = await readFile(filename, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const manifest = JSON.parse(source);
    if (
      manifest.name !== host ||
      manifest.type !== 'stdio' ||
      typeof manifest.path !== 'string' ||
      !path.isAbsolute(manifest.path)
    )
      throw new Error('Invalid native host registration.');
    if (
      !Array.isArray(manifest.allowed_origins) ||
      !manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`)
    )
      throw new Error('Native host does not allow this extension origin.');
    if (!(await stat(manifest.path)).isFile()) throw new Error('Native host executable is unavailable.');
    await access(manifest.path, constants.X_OK);
    return { name: host, path: manifest.path };
  }
  throw new Error(
    'Bitwarden desktop integration was not found. Enable browser integration in the Bitwarden desktop app.',
  );
}
