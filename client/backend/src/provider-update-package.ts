import path from 'node:path';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from './provider-update-adapter';
import type { ProviderInstallation } from './provider-updates';

type NativeInspection = { latestVersion?: string; command?: ProviderInstallation['command'] };
export type PackageUpdatePolicy = {
  packageName: string;
  command(): string;
  channel?(): Promise<string>;
  cask(resolved: string): { name: string; channel: string };
  userLocalExecutable?: string;
  latestVersion?(channel: string): Promise<string | undefined>;
  native(context: { executable: string; resolved: string; channel: string }): Promise<NativeInspection | undefined>;
  updatesDisabled?(): boolean;
  environment(installation: ProviderInstallation): NodeJS.ProcessEnv;
};

/** Shared package-manager provenance; native inspection and upgrade policy stay provider-owned. */
export class PackageProviderUpdateAdapter implements ProviderUpdateAdapter {
  constructor(private readonly io: ProviderUpdateIO, private readonly policy: PackageUpdatePolicy) {}

  async inspect(): Promise<ProviderInstallation> {
    const executable = this.io.resolve(this.policy.command());
    if (!executable) return { status: 'unavailable', method: 'manual', identity: 'missing' };
    const resolved = await this.io.realpath(executable);
    const version = parseVersion(await this.io.run(executable, ['--version'], 10_000));
    if (!version) throw new Error('The provider version could not be read.');
    let method: ProviderInstallation['method'] = 'manual';
    let channel = await this.policy.channel?.() ?? 'latest';
    let command: ProviderInstallation['command'];
    let latestVersion: string | undefined;
    // Windows package-manager shims and custom wrappers stay manual unless provenance is known.
    if (this.io.platform !== 'win32') {
      const brew = this.io.resolve('brew');
      if (brew && resolved.includes(`${path.sep}Caskroom${path.sep}`)) {
        const prefix = (await this.io.run(brew, ['--prefix'], 10_000)).trim();
        const { name: cask, channel: caskChannel } = this.policy.cask(resolved);
        if (inside(resolved, path.join(prefix, 'Caskroom', cask))) {
          const info = JSON.parse(await this.io.run(brew, ['info', '--cask', '--json=v2', cask], 30_000)) as { casks?: { token?: string; version?: string }[] };
          latestVersion = exactVersion(info.casks?.find(item => item.token === cask)?.version);
          method = 'homebrew'; channel = caskChannel;
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
          const userLocal = this.policy.userLocalExecutable !== undefined && path.resolve(executable) === path.join(prefix, 'bin', this.policy.userLocalExecutable)
            && inside(resolved, path.join(prefix, 'lib', 'node_modules', this.policy.packageName));
          if (userLocal) root = path.join(prefix, 'lib', 'node_modules');
          const packageRoot = path.join(root, this.policy.packageName);
          const canonicalRoot = await this.io.realpath(packageRoot).catch(() => '');
          if (canonicalRoot && inside(resolved, canonicalRoot)) {
            const metadata = JSON.parse(await this.io.read(path.join(canonicalRoot, 'package.json'))) as { name?: string };
            if (metadata.name === this.policy.packageName) {
              method = 'npm';
              latestVersion = await this.latestVersion(channel);
              if (latestVersion) command = { file: npmNode, args: [npmCli, 'install', '-g', ...(userLocal ? ['--prefix', prefix] : []), `${this.policy.packageName}@${latestVersion}`] };
            }
          }
        }
      }
      if (!command) {
        const native = await this.policy.native({ executable, resolved, channel });
        if (native) { method = 'native'; latestVersion = native.latestVersion; command = native.command; }
      }
    }
    // Unknown/custom installs may be observed, but never run an inferred installer against them.
    latestVersion ??= await registryVersion(this.io, this.policy.packageName);
    if (!latestVersion) throw new Error('No valid provider version was returned.');
    if (this.policy.updatesDisabled?.()) command = undefined;
    return { status: packageUpdateStatus(version, latestVersion), executable, version, latestVersion, method, channel,
      identity: JSON.stringify([executable, resolved, version, method, channel, command]), command };
  }

  async upgrade(installation: ProviderInstallation): Promise<void> {
    if (!installation.command || !installation.executable) throw new Error('Manual provider upgrade required.');
    await this.io.run(installation.command.file, installation.command.args, 5 * 60_000, this.policy.environment(installation));
  }

  private async latestVersion(channel: string): Promise<string | undefined> {
    return this.policy.latestVersion ? this.policy.latestVersion(channel) : registryVersion(this.io, this.policy.packageName);
  }
}

export async function registryVersion(io: ProviderUpdateIO, packageName: string): Promise<string | undefined> {
  const data = JSON.parse(await io.fetchText(`https://registry.npmjs.org/${packageName}/latest`)) as { version?: string };
  return exactVersion(data.version);
}

function parseVersion(output: string): string | undefined { return output.match(/\b(\d+\.\d+\.\d+(?:-[\w.-]+)?)\b/)?.[1]; }
export function exactVersion(value: unknown): string | undefined { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined; }
export function inside(file: string, directory: string): boolean { const relative = path.relative(directory, file); return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }

function packageUpdateStatus(installed?: string, candidate?: string): ProviderInstallation['status'] {
  if (!installed) return 'unavailable';
  if (!stableVersion(installed) || !stableVersion(candidate)) return 'manual';
  return newer(candidate, installed) ? 'available' : 'current';
}

function newer(candidate: string | undefined, installed: string | undefined): boolean {
  if (!stableVersion(candidate) || !stableVersion(installed)) return false;
  const a = candidate.split('.').map(Number), b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

function stableVersion(value?: string): value is string { return Boolean(value && /^\d+\.\d+\.\d+$/.test(value)); }
