import path from 'node:path';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from '../provider-update-adapter';
import { exactVersion, inside, PackageProviderUpdateAdapter, registryVersion } from '../provider-update-package';

export function createClaudeUpdateAdapter(io: ProviderUpdateIO, options: { command(): string; home(): string; env?: NodeJS.ProcessEnv }): ProviderUpdateAdapter {
  const disabled = () => Boolean(options.env?.DISABLE_UPDATES || process.env.DISABLE_UPDATES);
  return new PackageProviderUpdateAdapter(io, {
    packageName: '@anthropic-ai/claude-code', command: options.command,
    async channel() {
      const settings = JSON.parse(await io.read(path.join(options.home(), 'settings.json')).catch(() => '{}')) as { autoUpdatesChannel?: string };
      return settings.autoUpdatesChannel === 'stable' ? 'stable' : 'latest';
    },
    cask: resolved => resolved.includes(`${path.sep}claude-code@latest${path.sep}`)
      ? { name: 'claude-code@latest', channel: 'latest' } : { name: 'claude-code', channel: 'stable' },
    latestVersion: async channel => channel === 'stable'
      ? exactVersion((await io.fetchText('https://downloads.claude.ai/claude-code-releases/stable')).trim())
      : registryVersion(io, '@anthropic-ai/claude-code'),
    async native({ executable, resolved, channel }) {
      if (inside(resolved, path.join(io.home, '.local', 'share', 'claude', 'versions'))
        && path.resolve(executable) === path.join(io.home, '.local', 'bin', 'claude')) {
        const latestVersion = exactVersion((await io.fetchText(`https://downloads.claude.ai/claude-code-releases/${channel}`)).trim());
        return { latestVersion, command: disabled() ? undefined : { file: executable, args: ['update'] } };
      }
    },
    updatesDisabled: disabled,
    environment: () => ({ CLAUDE_CONFIG_DIR: options.home() }),
  });
}
