import { antigravityVersion } from '@korus-dev/multi-agent-sdk/runtime';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from '../provider-update-adapter';
import type { ProviderInstallation } from '../provider-updates';

/** Where the CLI's own installer reads the latest release for each platform. */
const releases = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests';
const platforms: Partial<Record<NodeJS.Platform, string>> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const architectures: Partial<Record<NodeJS.Architecture, string>> = { arm64: 'arm64', x64: 'amd64' };

/** The Antigravity CLI updates itself; this reports where it stands and runs its own updater on request. */
export class AntigravityUpdateAdapter implements ProviderUpdateAdapter {
  constructor(private readonly io: ProviderUpdateIO) {}

  async inspect(): Promise<ProviderInstallation> {
    const executable = process.env.APP_ANTIGRAVITY_COMMAND || this.io.resolve('agy');
    if (!executable) return { status: 'unavailable', provider: 'antigravity', method: 'manual', identity: 'antigravity:missing' };
    const version = (await this.io.run(executable, ['--version'], 15_000)).trim();
    const latestVersion = await this.latest();
    const installed = antigravityVersion(version), latest = antigravityVersion(latestVersion);
    const status: ProviderInstallation['status'] = installed === null || latest === null ? 'manual' : latest > installed ? 'available' : 'current';
    return { status, provider: 'antigravity', executable, version, ...(latestVersion ? { latestVersion } : {}), method: 'native',
      identity: JSON.stringify([await this.io.realpath(executable), version, latestVersion]),
      ...(status === 'available' ? { command: { file: executable, args: ['update'] } } : {}) };
  }

  async upgrade(installation: ProviderInstallation): Promise<void> {
    if (!installation.command || !installation.executable) throw new Error('Manual provider upgrade required.');
    await this.io.run(installation.command.file, installation.command.args, 5 * 60_000);
  }

  private async latest(): Promise<string | undefined> {
    const platform = platforms[this.io.platform], architecture = architectures[process.arch];
    if (!platform || !architecture) return undefined;
    const manifest: unknown = JSON.parse(await this.io.fetchText(`${releases}/${platform}_${architecture}.json`));
    return manifest && typeof manifest === 'object' && 'version' in manifest && typeof manifest.version === 'string' ? manifest.version : undefined;
  }
}
