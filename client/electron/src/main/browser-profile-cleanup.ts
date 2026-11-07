import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { warnMain } from './log';

/** Obsolete per-agent profiles are separate from the shared browser's saved logins. */
export async function cleanupLegacyBrowserProfiles(userData: string): Promise<void> {
  const directory = path.join(userData, 'Partitions');
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^agent-workspace-browser-[a-zA-Z\d_-]+$/u.test(entry.name)) continue;
    try {
      await rm(path.join(directory, entry.name), { recursive: true, force: true });
    } catch (error) {
      warnMain('browser', 'could not remove obsolete browser profile', {
        partition: entry.name, detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
