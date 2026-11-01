import { cp, lstat, mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CodexResourceSharingStatus, SetCodexResourceSharingInput } from '@workspace/core/contracts';
import { backendCodexHomeDir } from './state';

const resourceDirectoryNames = ['skills', 'plugins'] as const;

export type CodexResourceSharingPaths = {
  appCodexHome: string;
  userCodexHome: string;
};

function defaultCodexResourceSharingPaths(): CodexResourceSharingPaths {
  return {
    appCodexHome: backendCodexHomeDir(),
    userCodexHome: path.join(homedir(), '.codex'),
  };
}

export async function reconcileCodexResourceSharing(
  enabled: boolean,
  paths = defaultCodexResourceSharingPaths(),
): Promise<void> {
  if (enabled) {
    await shareCodexResources(paths);
    return;
  }

  await ensureIsolatedCodexResources(paths);
}

export async function initializeCodexResourceSharing(
  enabled: boolean,
  paths = defaultCodexResourceSharingPaths(),
): Promise<void> {
  if (!enabled) {
    await ensureIsolatedCodexResources(paths);
    return;
  }

  if (await hasConflictingCodexResources(paths)) return;
  await shareCodexResources(paths);
}

export async function getCodexResourceSharingStatus(
  enabled: boolean,
  paths = defaultCodexResourceSharingPaths(),
): Promise<CodexResourceSharingStatus> {
  return {
    enabled,
    migrationRequired: enabled && await hasConflictingCodexResources(paths),
  };
}

export async function setCodexResourceSharing(
  input: SetCodexResourceSharingInput,
  paths = defaultCodexResourceSharingPaths(),
): Promise<void> {
  if (input.enabled) {
    await shareCodexResources(paths);
    return;
  }

  if (input.mode === 'keep') return;

  await isolateCodexResources(input.mode, paths);
}

async function shareCodexResources(paths: CodexResourceSharingPaths): Promise<void> {
  await mkdir(paths.appCodexHome, { recursive: true, mode: 0o700 });
  await mkdir(paths.userCodexHome, { recursive: true, mode: 0o700 });

  for (const name of resourceDirectoryNames) {
    const sharedPath = path.join(paths.userCodexHome, name);
    const appPath = path.join(paths.appCodexHome, name);
    await mkdir(sharedPath, { recursive: true, mode: 0o700 });
    if (await isLinkTo(appPath, sharedPath)) continue;
    await rm(appPath, { recursive: true, force: true });
    // Windows directory junctions do not require symlink privileges or Developer Mode.
    await symlink(process.platform === 'win32' ? path.resolve(sharedPath) : path.relative(paths.appCodexHome, sharedPath),
      appPath, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function ensureIsolatedCodexResources(paths: CodexResourceSharingPaths): Promise<void> {
  await mkdir(paths.appCodexHome, { recursive: true, mode: 0o700 });
  for (const name of resourceDirectoryNames) {
    const appPath = path.join(paths.appCodexHome, name);
    if (await isSymbolicLink(appPath)) {
      await rm(appPath, { force: true });
    }
    await mkdir(appPath, { recursive: true, mode: 0o700 });
  }
}

async function isolateCodexResources(
  mode: Extract<SetCodexResourceSharingInput, { enabled: false }>['mode'],
  paths: CodexResourceSharingPaths,
): Promise<void> {
  await mkdir(paths.appCodexHome, { recursive: true, mode: 0o700 });
  await mkdir(paths.userCodexHome, { recursive: true, mode: 0o700 });

  for (const name of resourceDirectoryNames) {
    const sharedPath = path.join(paths.userCodexHome, name);
    const appPath = path.join(paths.appCodexHome, name);
    await mkdir(sharedPath, { recursive: true, mode: 0o700 });
    await rm(appPath, { recursive: true, force: true });
    if (mode === 'copy') {
      await cp(sharedPath, appPath, { recursive: true, preserveTimestamps: true });
    } else {
      await mkdir(appPath, { recursive: true, mode: 0o700 });
    }
  }
}

async function isLinkTo(linkPath: string, targetPath: string): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    if (!stats.isSymbolicLink()) return false;
    const target = await readlink(linkPath);
    return path.resolve(path.dirname(linkPath), target) === path.resolve(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasConflictingCodexResources(paths: CodexResourceSharingPaths): Promise<boolean> {
  for (const name of resourceDirectoryNames) {
    const appPath = path.join(paths.appCodexHome, name);
    const sharedPath = path.join(paths.userCodexHome, name);
    try {
      const stats = await lstat(appPath);
      // Turning sharing off creates empty directories; relinking them loses no data.
      if (stats.isDirectory() && (await readdir(appPath)).length === 0) continue;
      if (!await isLinkTo(appPath, sharedPath)) return true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function isSymbolicLink(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isSymbolicLink();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
