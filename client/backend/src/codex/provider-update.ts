import path from 'node:path';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from '../provider-update-adapter';
import { inside, PackageProviderUpdateAdapter, registryVersion } from '../provider-update-package';

export function createCodexUpdateAdapter(io: ProviderUpdateIO, options: { command(): string }): ProviderUpdateAdapter {
  return new PackageProviderUpdateAdapter(io, {
    packageName: '@openai/codex', command: options.command,
    cask: () => ({ name: 'codex', channel: 'latest' }),
    userLocalExecutable: 'codex',
    async native({ executable, resolved }) {
      // Standalone Codex installs have an installer-owned version directory. Custom paths stay manual.
      if (inside(resolved, path.join(io.home, '.codex', 'packages', 'standalone', 'releases'))
        && path.resolve(executable) === path.join(io.home, '.local', 'bin', 'codex')) {
        const help = await io.run(executable, ['update', '--help'], 10_000).catch(() => '');
        if (/\bupdate\b/i.test(help)) {
          return { latestVersion: await registryVersion(io, '@openai/codex'), command: { file: executable, args: ['update'] } };
        }
      }
    },
    environment: installation => ({
      ...(installation.method === 'native' && path.basename(installation.executable!) === 'codex' ? { CODEX_HOME: path.join(io.home, '.codex') } : {}),
    }),
  });
}
