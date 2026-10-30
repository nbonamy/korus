import type { ConversationContentChunk, ConversationContentInput } from './contracts/conversation';

/** SDK image references are scoped by the host to an agent and provider session. */
export function conversationImageInput(reference: string): Omit<ConversationContentInput, 'offset'> | null {
  const match = /^conversation-image:([^:]{1,1500}):([a-f0-9]{64})$/.exec(reference);
  if (!match) return null;
  try { return { sessionId: decodeURIComponent(match[1]!), contentId: match[2]! }; } catch { return null; }
}

/** The same bounded content reader serves desktop and native mobile image previews. */
export async function readEmbeddedConversationImage(reference: string, read: (input: ConversationContentInput) => Promise<ConversationContentChunk>): Promise<string> {
  const input = conversationImageInput(reference);
  if (!input) throw new Error('Invalid conversation image reference.');
  const chunks: string[] = []; let offset = 0; let total: number | undefined;
  for (;;) {
    const chunk = await read({ ...input, offset });
    if (!Number.isSafeInteger(chunk.totalBytes) || chunk.totalBytes <= 0 || chunk.totalBytes > 24 * 1024 * 1024
      || (total !== undefined && total !== chunk.totalBytes) || chunk.data.length > 128 * 1024) throw new Error('Invalid conversation image chunk.');
    total = chunk.totalBytes;
    const bytes = atob(chunk.data); const end = offset + bytes.length;
    if (!bytes.length || end > total || (chunk.nextOffset === null ? end !== total : chunk.nextOffset !== end)) throw new Error('Invalid conversation image offset.');
    chunks.push(bytes);
    if (chunk.nextOffset === null) break;
    offset = end;
  }
  const image = chunks.join('');
  if (!/^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,[a-z\d+/]+={0,2}$/i.test(image)) throw new Error('Invalid conversation image data.');
  return image;
}
