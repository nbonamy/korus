import { chmod, lstat, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PromptAttachment } from '@workspace/core/contracts';

export type CompanionUpload = { type: 'image' | 'file'; name: string; mimeType: string; data: Buffer };
const retentionMs = 86_400_000;

type CleanupOptions = { now?: number; activeAgentIds?: Iterable<string>; protectedPaths?: Iterable<string> };

/** Sweep independently of incoming uploads; never expire queued or active work. */
export async function cleanupPromptUploads(directory: string, options: CleanupOptions = {}): Promise<void> {
  const root = path.join(directory, 'uploads');
  const active = new Set(options.activeAgentIds);
  const protectedPaths = [...options.protectedPaths ?? []].map(file => path.resolve(file));
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.resolve(root, entry.name);
    try {
      if ((options.now ?? Date.now()) - (await lstat(folder)).mtimeMs <= retentionMs
        || protectedPaths.some(file => file.startsWith(`${folder}${path.sep}`))) continue;
      let agentId: string | undefined;
      try {
        const owner = path.join(folder, '.owner.json');
        if ((await stat(owner)).size <= 4096) {
          const metadata = JSON.parse(await readFile(owner, 'utf8'));
          if (metadata && typeof metadata.agentId === 'string') agentId = metadata.agentId;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      // Legacy folders have no owner: retain them while any agent is active.
      if (agentId ? active.has(agentId) : active.size > 0) continue;
      await rm(folder, { recursive: true, force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

/** Phone attachments become private files at stable paths the agent can read. */
export async function storePromptUploads(directory: string, uploads: readonly CompanionUpload[], now = Date.now(), agentId?: string): Promise<PromptAttachment[]> {
  if (uploads.length === 0) return [];
  const root = path.join(directory, 'uploads');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const folder = path.join(root, randomUUID());
  await mkdir(folder, { mode: 0o700 });
  if (agentId) await writeFile(path.join(folder, '.owner.json'), JSON.stringify({ agentId }), { mode: 0o600, flag: 'wx' });
  const attachments: PromptAttachment[] = [];
  for (const [index, upload] of uploads.entries()) {
    const name = path.basename(upload.name.replace(/\\/g, '/')).replace(/[^\w. -]/g, '_').slice(0, 120) || `attachment-${index + 1}`;
    const file = path.join(folder, `${index + 1}-${name}`);
    await writeFile(file, upload.data, { mode: 0o600, flag: 'wx' });
    await chmod(file, 0o600);
    attachments.push({ type: upload.type, path: file, name: upload.name, mimeType: upload.mimeType } as PromptAttachment);
  }
  await utimes(folder, new Date(now), new Date(now));
  return attachments;
}
