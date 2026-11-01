import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PromptAttachment } from '@workspace/core/contracts';

export type CompanionUpload = { type: 'image' | 'file'; name: string; mimeType: string; data: Buffer };
const retentionMs = 86_400_000;

/**
 * Phone attachments become files the agent can open. They live under the companion's protected directory,
 * one folder per prompt, and are swept after a day: the agent reads them during the turn that carries them.
 */
export async function storePromptUploads(directory: string, uploads: readonly CompanionUpload[], now = Date.now()): Promise<PromptAttachment[]> {
  if (uploads.length === 0) return [];
  const root = path.join(directory, 'uploads');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  for (const entry of await readdir(root)) {
    const folder = path.join(root, entry);
    if (now - (await stat(folder)).mtimeMs > retentionMs) await rm(folder, { recursive: true, force: true });
  }
  const folder = path.join(root, randomUUID());
  await mkdir(folder, { mode: 0o700 });
  const attachments: PromptAttachment[] = [];
  for (const [index, upload] of uploads.entries()) {
    const name = path.basename(upload.name.replace(/\\/g, '/')).replace(/[^\w. -]/g, '_').slice(0, 120) || `attachment-${index + 1}`;
    const file = path.join(folder, `${index + 1}-${name}`);
    await writeFile(file, upload.data, { mode: 0o600, flag: 'wx' });
    await chmod(file, 0o600);
    attachments.push({ type: upload.type, path: file, name: upload.name, mimeType: upload.mimeType } as PromptAttachment);
  }
  return attachments;
}
