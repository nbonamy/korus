import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SourceFolderEntry, SourceFolderListing } from '@workspace/core/contracts';

export async function listSourceFolders(folderPath?: string): Promise<SourceFolderListing> {
  const resolvedPath = await resolveFolderPath(folderPath);
  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const folders: SourceFolderEntry[] = [];

  for (const entry of entries) {
    const entryPath = path.join(resolvedPath, entry.name);
    if (entry.isDirectory() || (entry.isSymbolicLink() && await isDirectory(entryPath))) {
      folders.push({
        name: entry.name,
        path: entryPath,
      });
    }
  }

  folders.sort((left, right) => left.name.localeCompare(right.name));

  return {
    path: resolvedPath,
    parentPath: parentPath(resolvedPath),
    entries: folders,
  };
}

async function resolveFolderPath(folderPath?: string): Promise<string> {
  const candidate = expandHome(folderPath?.trim() || os.homedir());
  const folderStat = await stat(candidate);
  if (!folderStat.isDirectory()) {
    throw new Error('Source folder path must be a directory.');
  }
  return candidate;
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function parentPath(folderPath: string): string | null {
  const parent = path.dirname(folderPath);
  return parent === folderPath ? null : parent;
}

async function isDirectory(folderPath: string): Promise<boolean> {
  try {
    return (await stat(folderPath)).isDirectory();
  } catch {
    return false;
  }
}
