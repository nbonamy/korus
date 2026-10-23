import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AgentDirectoryEntry, AgentDirectoryInput, AgentDirectoryPage } from '@workspace/core/contracts/workspace';
import { skippedDirectoryNames } from './agent-files';

const pageSize = 250;

export async function listAgentDirectory(folder: string, input: AgentDirectoryInput = {}): Promise<AgentDirectoryPage> {
  if (input.path !== undefined && typeof input.path !== 'string') throw new Error('Invalid directory path.');
  if (input.query !== undefined && typeof input.query !== 'string') throw new Error('Invalid file search query.');
  const cursor = input.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid directory cursor.');
  const root = await realpath(folder);
  const current = await realpath(path.resolve(root, input.path || '.'));
  const relative = path.relative(root, current);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Directory is outside the workspace.');
  const query = input.query?.trim().toLocaleLowerCase();
  const entries: AgentDirectoryEntry[] = [];
  let matched = 0;
  for await (const entry of query ? search(root, query) : children(root, current)) {
    if (matched++ < cursor) continue;
    if (entries.length === pageSize) return { entries, nextCursor: cursor + pageSize };
    entries.push(entry);
  }
  return { entries, nextCursor: null };
}

async function* children(root: string, folder: string): AsyncGenerator<AgentDirectoryEntry> {
  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter(entry => entry.isFile() || (entry.isDirectory() && !skippedDirectoryNames.has(entry.name)))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const entry of entries) yield {
    name: entry.name,
    path: path.relative(root, path.join(folder, entry.name)).split(path.sep).join('/'),
    kind: entry.isDirectory() ? 'folder' : 'file',
  };
}

async function* search(root: string, query: string): AsyncGenerator<AgentDirectoryEntry> {
  const queue = [root];
  for (let index = 0; index < queue.length; index += 1) {
    for await (const entry of children(root, queue[index]!)) {
      if (entry.kind === 'folder') queue.push(path.join(root, entry.path));
      else if (entry.path.toLocaleLowerCase().includes(query)) yield entry;
    }
  }
}
