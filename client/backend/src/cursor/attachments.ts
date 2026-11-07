import { open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PromptAttachment } from '@workspace/core/contracts';

/** Desktop has already resolved these paths through its trusted attachment registry. */
export async function cursorAttachments(attachments: readonly PromptAttachment[]): Promise<unknown[]> {
  if (attachments.length > 10) throw new Error('Cursor supports up to 10 attachments.');
  const result: unknown[] = []; let bytes = 0;
  for (const attachment of attachments) {
    if (!path.isAbsolute(attachment.path)) throw new Error('A trusted local attachment is required.');
    const file = await open(attachment.path, 'r');
    try {
      const stat = await file.stat(); bytes += stat.size;
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || bytes > 30 * 1024 * 1024) throw new Error('Cursor attachment size limit exceeded.');
      const data = await file.readFile();
      if (data.length !== stat.size) throw new Error('Attachment changed while reading.');
      const mimeType = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
        : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg'
        : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
      if (mimeType) result.push({ type: 'image', mimeType, data: data.toString('base64') });
      else {
        if (attachment.type === 'image') throw new Error('Unsupported Cursor image format.');
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error('Unsupported binary Cursor attachment.'); }
        if (text.includes('\0')) throw new Error('Unsupported binary Cursor attachment.');
        result.push({ type: 'resource', resource: { uri: pathToFileURL(attachment.path).href, mimeType: 'text/plain', text } });
      }
    } finally { await file.close(); }
  }
  return result;
}
