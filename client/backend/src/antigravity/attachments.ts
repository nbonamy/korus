import { open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PromptAttachment } from '@workspace/core/contracts';

/** Input is resolved by the desktop's trusted registry, never a renderer path. */
export async function acpAttachments(attachments: readonly PromptAttachment[]): Promise<unknown[]> {
  if (attachments.length > 10) throw new Error('Antigravity supports up to 10 attachments per prompt.');
  let bytes = 0;
  return Promise.all(attachments.map(async attachment => {
    if (typeof attachment.path !== 'string' || !path.isAbsolute(attachment.path)) throw new Error('A trusted local attachment is required.');
    const file = await open(attachment.path, 'r');
    try {
      const stat = await file.stat();
      bytes += stat.size;
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || bytes > 30 * 1024 * 1024) throw new Error('Antigravity attachments exceed the size limit.');
      const data = await file.readFile();
      if (data.length !== stat.size) throw new Error('The attachment changed while reading it.');
      const uri = pathToFileURL(attachment.path).href;
      const name = attachment.name ?? path.basename(attachment.path);
      if (data.subarray(0, 5).toString() === '%PDF-') return { type: 'resource_link', uri, name, mimeType: 'application/pdf' };
      const mimeType = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg'
        : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
        : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE' ? 'audio/wav' : null;
      if (mimeType) return { type: mimeType.startsWith('image/') ? 'image' : 'audio', mimeType, data: data.toString('base64') };
      if (attachment.type === 'image' || attachment.mimeType?.startsWith('audio/') || attachment.mimeType === 'application/pdf') throw new Error('Unsupported Antigravity attachment format.');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error('Antigravity supports images, WAV audio, PDF, and UTF-8 text attachments.'); }
      if (text.includes('\0')) throw new Error('Unsupported binary attachment.');
      return { type: 'resource', resource: { uri, mimeType: 'text/plain', text } };
    } finally { await file.close(); }
  }));
}
