import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { PromptAttachment } from '@workspace/core/contracts';

type ImageAttachment = Extract<PromptAttachment, { type: 'image' }>;

/** Utility inputs are trusted host paths, never renderer attachment references or remote URLs. */
export async function utilityImageAttachments(value: unknown): Promise<ImageAttachment[]> {
  if (!Array.isArray(value) || value.length > 4) throw new Error('Utilities support up to four image attachments.');
  const result: ImageAttachment[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || item.type !== 'image' || typeof item.path !== 'string' || !path.isAbsolute(item.path)) throw new Error('A trusted absolute image attachment path is required.');
    if (item.detail !== undefined && !['auto', 'low', 'high', 'original'].includes(item.detail)) throw new Error('Invalid image attachment detail.');
    const resolved = await realpath(item.path);
    const file = await open(resolved, 'r');
    try {
      const stat = await file.stat();
      total += stat.size;
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error('Utility image attachments exceed the size limit.');
      const header = Buffer.alloc(12);
      await file.read(header, 0, header.length, 0);
      const mimeType = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : header[0] === 255 && header[1] === 216 && header[2] === 255 ? 'image/jpeg'
        : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
      if (!mimeType || (item.mimeType !== undefined && item.mimeType !== mimeType)) throw new Error('Unsupported or mismatched utility image attachment format.');
      result.push({ type: 'image', path: resolved, mimeType, ...(item.detail ? { detail: item.detail } : {}), ...(typeof item.name === 'string' ? { name: item.name } : {}) });
    } finally { await file.close(); }
  }
  return result;
}
