import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentFilePreviewResult, AgentFileSearchItem } from '@workspace/core/contracts';
import type { AgentFileChunk } from '@workspace/core/contracts/workspace';

const DEFAULT_AGENT_FILE_LIMIT = 1000;
const DEFAULT_AGENT_FILE_DEPTH = 8;
const DEFAULT_AGENT_FILE_READ_BYTES = 2 * 1024 * 1024;

export const skippedDirectoryNames = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);

export type ListAgentFolderFilesOptions = {
  maxDepth?: number;
  maxFiles?: number;
};

export async function listAgentFolderFiles(
  folder: string,
  options: ListAgentFolderFilesOptions = {},
): Promise<AgentFileSearchItem[]> {
  const root = path.resolve(folder);
  const maxDepth = options.maxDepth ?? DEFAULT_AGENT_FILE_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_AGENT_FILE_LIMIT;
  const files: AgentFileSearchItem[] = [];

  await visitFolder(root, 0);

  return files.sort((a, b) => a.path.localeCompare(b.path));

  async function visitFolder(currentFolder: string, depth: number): Promise<void> {
    if (files.length >= maxFiles || depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(currentFolder, { withFileTypes: true });
    } catch (error) {
      if (currentFolder === root) {
        throw error;
      }
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(currentFolder, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectoryNames.has(entry.name)) {
          await visitFolder(absolutePath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      files.push({
        name: entry.name,
        path: relativePath,
      });
    }
  }
}

export async function previewAgentFolderFile(
  folder: string | undefined,
  filePath: string,
  options: { maxBytes?: number } = {},
): Promise<AgentFilePreviewResult> {
  const resolvedPath = await resolveAgentFilePath(folder, filePath);
  const fileStat = await stat(resolvedPath.absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${resolvedPath.previewPath}`);
  }

  if (fileStat.size > (options.maxBytes ?? DEFAULT_AGENT_FILE_READ_BYTES)) {
    return { path: resolvedPath.previewPath, size: fileStat.size, kind: 'tooLarge' };
  }

  const buffer = await readFile(resolvedPath.absolutePath);
  const mimeType = imageMimeType(resolvedPath.previewPath);
  if (mimeType) {
    return {
      path: resolvedPath.previewPath,
      size: fileStat.size,
      kind: 'image',
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
  }
  if (buffer.includes(0)) {
    return { path: resolvedPath.previewPath, size: fileStat.size, kind: 'binary' };
  }
  return {
    path: resolvedPath.previewPath,
    size: fileStat.size,
    kind: 'text',
    content: buffer.toString('utf8'),
  };
}

export async function readAgentFolderFileChunk(folder: string | undefined, filePath: string, offset: number): Promise<AgentFileChunk> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid file offset.');
  const resolved = await resolveAgentFilePath(folder, filePath);
  if (!(await stat(resolved.absolutePath)).isFile()) throw new Error('Path is not a file.');
  const file = await open(resolved.absolutePath, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Path is not a file.');
    if (offset > info.size) throw new Error('File changed while downloading.');
    const buffer = Buffer.alloc(Math.min(512 * 1024, info.size - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return { path: resolved.previewPath, size: info.size, data: buffer.subarray(0, bytesRead).toString('base64'), nextOffset: offset + bytesRead };
  } finally {
    await file.close();
  }
}

async function resolveAgentFilePath(folder: string | undefined, filePath: string): Promise<{ absolutePath: string; previewPath: string }> {
  const absoluteInput = path.isAbsolute(filePath);
  let target: string;
  if (absoluteInput) {
    target = path.resolve(filePath);
  } else {
    if (!folder) throw new Error('This session does not have a project workspace.');
    target = path.resolve(folder, filePath);
  }
  const realTarget = await realpath(target);

  return {
    absolutePath: realTarget,
    previewPath: (absoluteInput ? target : path.normalize(filePath)).split(path.sep).join('/'),
  };
}

function imageMimeType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  } as Record<string, string>)[extension] ?? null;
}
