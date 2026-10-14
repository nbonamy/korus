import { createHash } from 'node:crypto';
import type { RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
import type { ConversationContentChunk, ConversationContentInput } from '@workspace/core/contracts/conversation';

// Leave room for routing envelopes and snapshot state under the 4 MiB event limit.
const pageBytes = 1024 * 1024;
const pageCount = 50;
// A row is shown whole. Only a part of it that is huge on its own (a screenshot, a file dump) is cut, so a long turn with
// many ordinary tool results is never reduced; a row that still would not fit a page is cut part by part, smallest cut first.
const partBytes = 256 * 1024;
const partTiers = [partBytes, 64 * 1024, 16 * 1024, 4 * 1024, 1024];
const messageBytes = 1536 * 1024;
const bodyHead = 8 * 1024;
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const chunkBytes = 64 * 1024;

/** One immutable history read, with cursors independent of transcript appends. */
export class ClaudeHistoryWindow {
  private before: number;
  private readonly content = new Map<string, Buffer>();
  private readonly contentByMessage = new Map<string, string>();

  private readonly messages: RendererMessage[];

  constructor(public sessionId: string | null, messages: RendererMessage[] = []) {
    this.messages = [...messages];
    this.before = messages.length;
  }

  get hasOlder(): boolean { return this.before > 0; }
  isDeferred(messageId: string): boolean { return this.contentByMessage.has(messageId); }

  older(): { messages: RendererMessage[]; hasOlder: boolean } {
    const page = this.recent(this.messages.slice(0, this.before));
    this.before -= page.length;
    return { messages: page, hasOlder: this.hasOlder };
  }

  /** Reopening a bounded window makes its preceding history reachable again. */
  reopen(messages: RendererMessage[]): RendererMessage[] {
    this.capture(messages);
    const page = this.recent(messages);
    const first = page[0];
    const index = first ? this.messages.findIndex((message) => message.id === first.id) : -1;
    if (index >= 0) this.before = index;
    return page;
  }

  capture(messages: RendererMessage[]): void {
    const indexes = new Map(this.messages.map((message, index) => [message.id, index]));
    for (const message of messages) {
      const index = indexes.get(message.id);
      if (index === undefined) {
        indexes.set(message.id, this.messages.length);
        this.messages.push(message);
      } else if (!message.deferredContent) this.messages[index] = message;
    }
  }

  readMessages(current: RendererMessage[]): RendererMessage[] {
    this.capture(current);
    return structuredClone(this.messages);
  }

  private recent(messages: RendererMessage[]): RendererMessage[] {
    const page: RendererMessage[] = [];
    let bytes = 2;
    for (let i = messages.length - 1; i >= 0 && page.length < pageCount; i--) {
      const message = this.project(messages[i]!);
      const size = Buffer.byteLength(JSON.stringify(message)) + 1;
      if (page.length && bytes + size > pageBytes) break;
      page.unshift(message);
      bytes += size;
    }
    return page;
  }

  /** The row as it travels: unchanged unless a part of it is too big, in which case only those parts are cut and the full row stays readable by content ID. */
  project(message: RendererMessage): RendererMessage {
    let parts = message.parts;
    let cut = false;
    for (const limit of partTiers) {
      parts = message.parts.map((part) => shrinkPart(part, limit));
      cut = parts.some((part, index) => part !== message.parts[index]);
      if (size(parts) <= messageBytes) break;
    }
    if (size(parts) > messageBytes) {
      // Thousands of small rows: keep what fits, in order, and say the rest is elsewhere.
      let used = 2;
      const fit = parts.filter((part) => (used += size(part) + 1) <= messageBytes - 1024);
      parts = [...fit, { type: 'status', text: 'More rows are not shown here' }];
      cut = true;
    }
    if (!cut) {
      const previous = this.contentByMessage.get(message.id);
      if (previous && !message.deferredContent) { this.content.delete(previous); this.contentByMessage.delete(message.id); }
      return message;
    }
    const bytes = Buffer.from(JSON.stringify(message));
    const contentId = createHash('sha256').update(bytes).digest('hex');
    const previous = this.contentByMessage.get(message.id);
    if (previous && previous !== contentId) this.content.delete(previous);
    this.contentByMessage.set(message.id, contentId);
    this.content.set(contentId, bytes);
    return { ...message, parts, deferredContent: { contentId, byteLength: bytes.length } };
  }

  read(input: ConversationContentInput): ConversationContentChunk {
    const bytes = input.sessionId === this.sessionId ? this.content.get(input.contentId) : undefined;
    if (!bytes) throw new Error('Conversation content is no longer available. Reload the conversation.');
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset >= bytes.length) throw new Error('Invalid conversation content offset.');
    const end = Math.min(input.offset + chunkBytes, bytes.length);
    return { data: bytes.subarray(input.offset, end).toString('base64'), nextOffset: end < bytes.length ? end : null, totalBytes: bytes.length };
  }
}

/** One part cut to a preview when it is larger than `limit`; every smaller part is returned as it is. */
function shrinkPart(part: RendererMessagePart, limit: number): RendererMessagePart {
  if (size(part) <= limit) return part;
  const head = (text: string, keep: number) => `${text.slice(0, keep)}\n… ${(text.length - keep).toLocaleString('en-US')} more characters not shown`;
  if (part.type === 'tool') {
    const full = part.body ?? (part.output === undefined ? '' : typeof part.output === 'string' ? part.output : JSON.stringify(part.output));
    const keep = Math.min(bodyHead, Math.max(256, Math.floor(limit / 2)));
    return { type: 'tool', id: part.id, kind: part.kind, title: part.title.slice(0, 256), status: part.status,
      ...(full ? { body: head(full, keep) } : {}),
      ...(part.input !== undefined && size(part.input) < Math.min(2048, limit / 4) ? { input: part.input } : {}),
      ...(part.statusText && part.statusText.length < 1024 ? { statusText: part.statusText } : {}),
      ...(part.metadata && size(part.metadata) < 1024 ? { metadata: part.metadata } : {}) };
  }
  if (part.type === 'text') return { ...part, text: head(part.text, Math.max(512, Math.floor(limit / 2))) };
  return { type: 'status', text: 'Content available on demand' };
}
