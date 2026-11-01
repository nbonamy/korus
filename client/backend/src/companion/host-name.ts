import { execFile } from 'node:child_process';
import { hostname as osHostname } from 'node:os';
import { promisify } from 'node:util';

const maxLength = 60;

/** A name the phone can show: one line, no control characters, trimmed to a reasonable length. */
export function friendlyHostName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

type Sources = { platform: NodeJS.Platform; computerName(): Promise<string>; hostname(): string };

/** What the person calls this computer: the macOS Computer Name when there is one, else its network name without the domain. */
export async function resolveHostName(sources: Sources): Promise<string> {
  if (sources.platform === 'darwin') {
    const named = friendlyHostName(await sources.computerName().catch(() => ''));
    if (named) return named;
  }
  return friendlyHostName(sources.hostname().split('.')[0] ?? '');
}

export const systemHostName = () => resolveHostName({
  platform: process.platform,
  computerName: async () => (await promisify(execFile)('scutil', ['--get', 'ComputerName'], { timeout: 2_000 })).stdout,
  hostname: osHostname,
});
