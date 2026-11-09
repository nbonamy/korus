import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from '../provider-update-adapter';
import type { ProviderInstallation } from '../provider-updates';
import { cursorEnvironment, cursorRuntime, cursorVersion } from './runtime';

/** Cursor's native updater targets its own home and uses date/hash build versions. */
export class CursorUpdateAdapter implements ProviderUpdateAdapter {
  constructor(private readonly io: ProviderUpdateIO, private readonly home?: () => ProviderHomeSettings | undefined) {}

  async inspect(): Promise<ProviderInstallation> {
    const runtime = cursorRuntime(this.home?.());
    const executable = this.io.resolve('agent') ?? this.io.resolve('cursor-agent');
    if (!executable) return { status: 'unavailable', backend: 'cursor', method: 'manual', identity: 'cursor:missing' };
    const resolved = await this.io.realpath(executable);
    const about: unknown = JSON.parse(await this.io.run(executable, ['about', '--format', 'json'], 15_000, cursorEnvironment(false, runtime)));
    if (!about || typeof about !== 'object' || !('cliVersion' in about) || !('latestStatus' in about)
      || typeof about.cliVersion !== 'string' || cursorVersion(about.cliVersion) === null || typeof about.latestStatus !== 'string') {
      throw new Error('Could not read Cursor CLI version.');
    }
    const latestVersion = about.latestStatus === 'up_to_date' ? about.cliVersion
      : 'latestVersion' in about && typeof about.latestVersion === 'string' && cursorVersion(about.latestVersion) !== null ? about.latestVersion : undefined;
    // Native installer targets HOME/.local, independently of the running executable.
    // A private HOME would install a second CLI rather than upgrade the detected one.
    const command = latestVersion && !runtime.isolated ? { file: executable, args: ['update'] } : undefined;
    return { status: cursorUpdateStatus(about.cliVersion, latestVersion), backend: 'cursor', executable, version: about.cliVersion, latestVersion, method: 'native',
      identity: JSON.stringify([resolved, about.cliVersion, about.latestStatus, latestVersion, runtime.homePath, runtime.isolated]), command };
  }

  async upgrade(installation: ProviderInstallation): Promise<void> {
    const runtime = cursorRuntime(this.home?.());
    if (!installation.command || !installation.executable || runtime.isolated) throw new Error('Manual provider upgrade required.');
    await this.io.run(installation.command.file, installation.command.args, 5 * 60_000, cursorEnvironment(false, runtime));
  }
}

function cursorUpdateStatus(installed: string, candidate?: string): ProviderInstallation['status'] {
  const a = cursorVersion(candidate), b = cursorVersion(installed);
  if (a === null || b === null) return 'manual';
  return a >= b && candidate !== installed ? 'available' : 'current';
}
