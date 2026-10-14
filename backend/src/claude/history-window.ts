import { createHash } from 'node:crypto';
import type { RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
import type { ConversationContentChunk, ConversationContentInput } from '@workspace/core/contracts/conversation';

// Leave room for routing envelopes and snapshot state under the 4 MiB event limit.
const pageBytes = 512 * 1024;
const messageBytes = 16 * 1024;
const pageCount = 50;
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

  project(message: RendererMessage): RendererMessage {
    const json = JSON.stringify(message);
    if (Buffer.byteLength(json) <= messageBytes) {
      const previous = this.contentByMessage.get(message.id);
      if (previous && !message.deferredContent) { this.content.delete(previous); this.contentByMessage.delete(message.id); }
      return message;
    }
    const bytes = Buffer.from(json);
    const contentId = createHash('sha256').update(bytes).digest('hex');
    const previous = this.contentByMessage.get(message.id);
    if (previous && previous !== contentId) this.content.delete(previous);
    this.contentByMessage.set(message.id, contentId);
    this.content.set(contentId, bytes);
    // These are previews. The exact original row remains available by content ID.
    let parts: RendererMessagePart[] = message.parts.map((part) => {
      if (Buffer.byteLength(JSON.stringify(part)) < 4096) return part;
      if (part.type === 'tool') return { type: 'tool', id: part.id, kind: part.kind, title: part.title.slice(0, 256), status: part.status,
        ...(part.input !== undefined && Buffer.byteLength(JSON.stringify(part.input)) < 2048 ? { input: part.input } : {}),
        ...(part.statusText && part.statusText.length < 1024 ? { statusText: part.statusText } : {}),
        ...(part.metadata && Buffer.byteLength(JSON.stringify(part.metadata)) < 1024 ? { metadata: part.metadata } : {}) };
      if (part.type === 'text') return { ...part, text: part.text.slice(0, 512) };
      return { type: 'status', text: 'Content available on demand' };
    });
    if (Buffer.byteLength(JSON.stringify(parts)) > 12 * 1024) parts = parts.slice(0, 2);
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
