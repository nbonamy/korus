import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveRuntimeExecutable, withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderInstallation } from './provider-updates';

const packages = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
const exec = promisify(execFile);
type Dependencies = {
  resolve(command: string): string | null;
  realpath(file: string): Promise<string>;
  read(file: string): Promise<string>;
  run(file: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<string>;
  fetchText(url: string): Promise<string>;
  home: string;
  platform: NodeJS.Platform;
};

/** Detects the installation actually used by Korus; never switches package managers. */
export class ProviderUpdateRuntime {
  private readonly io: Dependencies;
  constructor(private readonly options: { command(backend: AgentBackend): string; claudeHome(): string; env?: NodeJS.ProcessEnv }, dependencies: Partial<Dependencies> = {}) {
    this.io = {
      resolve: command => resolveRuntimeExecutable(command, { env: { ...process.env, ...options.env } }), realpath, read: file => readFile(file, 'utf8'),
      run: async (file, args, timeout, env) => (await exec(file, args, {
        timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: withDiscoveredRuntimePath({ ...options.env, ...env }),
      })).stdout,
      fetchText: async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
        if (!response.ok) throw new Error('Provider version lookup failed.');
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('Provider version response is too large.');
        return text;
      },
      home: homedir(), platform: process.platform, ...dependencies,
    };
  }

  async inspect(backend: AgentBackend): Promise<ProviderInstallation> {
    if (backend === 'antigravity') throw new Error('Antigravity updates are managed externally.');
    const executable = this.io.resolve(this.options.command(backend));
    if (!executable) return { method: 'manual', identity: 'missing' };
    const resolved = await this.io.realpath(executable);
    const version = parseVersion(await this.io.run(executable, ['--version'], 10_000));
    if (!version) throw new Error('The provider version could not be read.');
    let method: ProviderInstallation['method'] = 'manual';
    const claudeSettings = backend === 'claude'
      ? JSON.parse(await this.io.read(path.join(this.options.claudeHome(), 'settings.json')).catch(() => '{}')) as { autoUpdatesChannel?: string }
      : undefined;
    let channel = claudeSettings?.autoUpdatesChannel === 'stable' ? 'stable' : 'latest';
    let command: ProviderInstallation['command'];
    let latestVersion: string | undefined;
    // Windows package-manager shims and custom wrappers stay manual unless provenance is known.
    if (this.io.platform !== 'win32') {
      const brew = this.io.resolve('brew');
      if (brew && resolved.includes(`${path.sep}Caskroom${path.sep}`)) {
        const prefix = (await this.io.run(brew, ['--prefix'], 10_000)).trim();
        const cask = backend === 'codex' ? 'codex' : resolved.includes(`${path.sep}claude-code@latest${path.sep}`) ? 'claude-code@latest' : 'claude-code';
        if (inside(resolved, path.join(prefix, 'Caskroom', cask))) {
          const info = JSON.parse(await this.io.run(brew, ['info', '--cask', '--json=v2', cask], 30_000)) as { casks?: { token?: string; version?: string }[] };
          latestVersion = exactVersion(info.casks?.find(item => item.token === cask)?.version);
          method = 'homebrew'; channel = cask === 'claude-code' ? 'stable' : 'latest';
          command = { file: brew, args: ['upgrade', '--cask', cask] };
        }
      }
      if (!command) {
        const npm = this.io.resolve('npm');
        const npmNode = npm ? this.io.resolve(path.join(path.dirname(npm), 'node')) : null;
        if (npm && npmNode && resolved.includes(`${path.sep}node_modules${path.sep}`)) {
          // npm's default prefix is derived from process.execPath. Its shebang
          // must not accidentally pick the desktop's private Node from PATH.
          const npmCli = await this.io.realpath(npm);
          let root = (await this.io.run(npmNode, [npmCli, 'root', '-g'], 10_000)).trim();
          const prefix = path.join(this.io.home, '.local');
          const userLocal = backend === 'codex' && path.resolve(executable) === path.join(prefix, 'bin', 'codex')
            && inside(resolved, path.join(prefix, 'lib', 'node_modules', packages.codex));
          if (userLocal) root = path.join(prefix, 'lib', 'node_modules');
          const packageRoot = path.join(root, packages[backend]);
          const canonicalRoot = await this.io.realpath(packageRoot).catch(() => '');
          if (canonicalRoot && inside(resolved, canonicalRoot)) {
            const metadata = JSON.parse(await this.io.read(path.join(canonicalRoot, 'package.json'))) as { name?: string };
            if (metadata.name === packages[backend]) {
              method = 'npm';
              latestVersion = backend === 'claude' && channel === 'stable'
                ? exactVersion((await this.io.fetchText('https://downloads.claude.ai/claude-code-releases/stable')).trim())
                : await this.registryVersion(backend);
              if (latestVersion) command = { file: npmNode, args: [npmCli, 'install', '-g', ...(userLocal ? ['--prefix', prefix] : []), `${packages[backend]}@${latestVersion}`] };
            }
          }
        }
      }
      if (!command && backend === 'claude' && inside(resolved, path.join(this.io.home, '.local', 'share', 'claude', 'versions'))
        && path.resolve(executable) === path.join(this.io.home, '.local', 'bin', 'claude')) {
        latestVersion = exactVersion((await this.io.fetchText(`https://downloads.claude.ai/claude-code-releases/${channel}`)).trim());
        method = 'native';
        if (!this.options.env?.DISABLE_UPDATES && !process.env.DISABLE_UPDATES) command = { file: executable, args: ['update'] };
      }
      // Standalone Codex installs have an installer-owned version directory. Custom paths stay manual.
      if (!command && backend === 'codex' && inside(resolved, path.join(this.io.home, '.codex', 'packages', 'standalone', 'releases'))
        && path.resolve(executable) === path.join(this.io.home, '.local', 'bin', 'codex')) {
        const help = await this.io.run(executable, ['update', '--help'], 10_000).catch(() => '');
        if (/\bupdate\b/i.test(help)) {
          method = 'native'; latestVersion = await this.registryVersion(backend);
          command = { file: executable, args: ['update'] };
        }
      }
    }
    // Unknown/custom installs may be observed, but never run an inferred installer against them.
    latestVersion ??= await this.registryVersion(backend);
    if (!latestVersion) throw new Error('No valid provider version was returned.');
    if (backend === 'claude' && (this.options.env?.DISABLE_UPDATES || process.env.DISABLE_UPDATES)) command = undefined;
    return { executable, version, latestVersion, method, channel,
      identity: JSON.stringify([executable, resolved, version, method, channel, command]), command };
  }

  async upgrade(installation: ProviderInstallation): Promise<void> {
    if (!installation.command || !installation.executable) throw new Error('Manual provider upgrade required.');
    await this.io.run(installation.command.file, installation.command.args, 5 * 60_000, {
      CLAUDE_CONFIG_DIR: this.options.claudeHome(),
      ...(installation.method === 'native' && path.basename(installation.executable) === 'codex' ? { CODEX_HOME: path.join(this.io.home, '.codex') } : {}),
    });
  }

  private async registryVersion(backend: keyof typeof packages): Promise<string | undefined> {
    const data = JSON.parse(await this.io.fetchText(`https://registry.npmjs.org/${packages[backend]}/latest`)) as { version?: string };
    return exactVersion(data.version);
  }
}

function parseVersion(output: string): string | undefined { return output.match(/\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/)?.[1]; }
function exactVersion(value: unknown): string | undefined { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined; }
function inside(file: string, directory: string): boolean { const relative = path.relative(directory, file); return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
