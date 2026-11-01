import type { Stats } from 'node:fs';
import { open } from 'node:fs/promises';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeTranscriptSlice = { content: string; offset: number; version: Stats };

/** The SDK supplies current-chain UUIDs; native metadata supplies canonical prompt/steer boundaries. */
export async function readRecentClaudeTranscript(file: string, messages: SessionMessage[]): Promise<ClaudeTranscriptSlice | null> {
  const inputs = messages.filter(message => message.type === 'user' && isInput(message.message));
  const anchors = new Set((inputs.length ? inputs.slice(-25) : messages.slice(-50)).map(message => message.uuid));
  if (!anchors.size || anchors.has('')) return null;
  const handle = await open(file, 'r');
  try {
    const version = await handle.stat();
    const chunks: Buffer[] = [];
    let position = version.size;
    let pending: Buffer[] = [];
    let start: number | undefined;
    let prompt: string | undefined;
    let complete = false;
    // Decode complete lines only: a chunk boundary may split JSON or a UTF-8 code point.
    while (position > 0 && !complete) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const chunk = await readBytes(handle, position, length);
      chunks.unshift(chunk);
      let end = chunk.length;
      while (end > 0) {
        const newline = chunk.lastIndexOf(10, end - 1);
        if (newline < 0 && position > 0) { pending.unshift(chunk.subarray(0, end)); break; }
        const begin = newline + 1;
        const bytes = pending.length ? Buffer.concat([chunk.subarray(begin, end), ...pending]) : chunk.subarray(begin, end);
        pending = [];
        let entry: Record<string, unknown> | undefined;
        try { entry = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; } catch { /* Native writes can leave an incomplete final record. */ }
        if (entry && !entry.isSidechain) {
          if (typeof entry.uuid === 'string') anchors.delete(entry.uuid);
          if (!anchors.size && entry.type === 'user' && !entry.isMeta && !entry.isCompactSummary && isInput(entry.message)) {
            const key = typeof entry.promptId === 'string' ? entry.promptId : entry.uuid;
            if (typeof key !== 'string' || !key) return null;
            if (prompt !== undefined && prompt !== key) { complete = true; break; }
            prompt = key;
            start = position + begin;
          }
        }
        if (newline < 0) { end = 0; break; }
        end = newline;
      }
    }
    if (anchors.size || start === undefined) return null;
    // At BOF include leading system records too. Otherwise start at a complete native turn.
    const offset = complete ? start : 0;
    return { content: Buffer.concat(chunks).subarray(offset - position).toString('utf8'), offset, version };
  } finally { await handle.close(); }
}

/** Read only the original snapshot, even if the live query has appended more turns. */
export async function readClaudeArchive(file: string, slice: ClaudeTranscriptSlice): Promise<string> {
  const handle = await open(file, 'r').catch(() => null);
  if (!handle) throw new Error('Claude history is unavailable. Restore it or reload the conversation.');
  try {
    const current = await handle.stat();
    if (current.ino !== slice.version.ino || current.dev !== slice.version.dev || current.size < slice.version.size
      || current.size === slice.version.size && current.mtimeMs !== slice.version.mtimeMs) throw new Error('changed');
    const bytes = await readBytes(handle, 0, slice.version.size);
    if (bytes.subarray(slice.offset).toString('utf8') !== slice.content) throw new Error('changed');
    return bytes.toString('utf8');
  } catch {
    throw new Error('Claude history changed. Reload the conversation before loading older messages.');
  } finally { await handle.close(); }
}

async function readBytes(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset);
    if (!bytesRead) throw new Error('Claude history changed while reading. Reload the conversation.');
    offset += bytesRead;
  }
  return bytes;
}

function isInput(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message)) return false;
  const content = message.content;
  return typeof content === 'string' ? Boolean(content.trim()) : Array.isArray(content)
    && !content.some(block => block?.type === 'tool_result')
    && content.some(block => block?.type === 'text' && typeof block.text === 'string' && block.text.trim());
}
