import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import type { AgentFilePreviewResult } from '@workspace/core/contracts';
import type { CompanionImage, CompanionReset } from '@workspace/core/companion-protocol';

/** Authoritative message references are the allowlist; a phone cannot turn this into a file browser. */
export function conversationImageReference(frame: CompanionReset, requestedPath: string): string {
  const normalized = imagePath(requestedPath);
  if (!normalized) throw new Error('Image is unavailable.');
  for (const message of frame.payload.snapshot.messages) {
    for (const part of message.parts) {
      const references: string[] = [];
      if (part.type === 'text') {
        marked.walkTokens(marked.lexer(part.text), token => {
          if (token.type === 'link' || token.type === 'image') references.push(token.href);
        });
      } else if (part.type === 'attachment' && part.attachment.kind === 'image') {
        if (part.attachment.path) references.push(part.attachment.path);
        if (part.attachment.url) references.push(part.attachment.url);
      } else if (part.type === 'media') references.push(part.media.url);
      if (references.some(reference => imagePath(reference) === normalized)) return normalized;
    }
  }
  throw new Error('Image is not referenced by this conversation.');
}

function imagePath(reference: string): string | null {
  try {
    // The shared Markdown renderer hands over a destination written as `<path>` with its brackets.
    reference = reference.trim();
    if (reference.startsWith('<') && reference.endsWith('>')) reference = reference.slice(1, -1);
    const value = reference.startsWith('file:') ? fileURLToPath(reference) : decodeURIComponent(reference);
    if (/^[a-z][a-z\d+.-]*:/iu.test(value) && !/^[a-z]:[\\/]/iu.test(value)) return null;
    if (!/\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/iu.test(value) || value.includes('\0')) return null;
    return path.normalize(value);
  } catch { return null; }
}

const maxImageUrlLength = 3 * 1024 * 1024;
/** Read on demand from the owning host without retaining a copy. */
export async function readConversationImage(load: () => Promise<AgentFilePreviewResult>): Promise<CompanionImage> {
  const preview = await load();
  if (preview.kind !== 'image' || !preview.dataUrl || !validImage(preview.dataUrl)) throw new Error('Image is unavailable or too large.');
  return { dataUrl: preview.dataUrl };
}

function validImage(value: string): boolean {
  return value.length <= maxImageUrlLength && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif);base64,[a-z\d+/]+={0,2}$/iu.test(value);
}
