import type { ClaudeHistorySource, ClaudeHistoryState } from './history-source';
import { withInferredTurnWorkPhases } from '@workspace/core/conversation-work-phases';
import { createHash } from 'node:crypto';
import type { ClaudeConversationTurn, RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
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
  private readonly initialIds: Set<string>;
  private visibleIds = new Set<string>();
  private readonly loadedTurns = new Set<string>();
  private readonly historyMessages: Map<string, RendererMessage>;
  private readonly archiveTurns = new Map<string, ClaudeConversationTurn>();
  private pendingArchive?: Promise<void>;
  private recoveredState?: ClaudeHistoryState;

  constructor(public sessionId: string | null, messages: RendererMessage[] = [], private readonly summaryTurnIds = new Set<string>(), private source?: ClaudeHistorySource) {
    this.initialIds = new Set(messages.map(message => message.id));
    this.historyMessages = phasedHistory(messages, this.summaryTurnIds);
    const workTurns = new Set([...this.historyMessages.values()].filter(message => message.kind === 'steer' || message.parts.some(isWork)).map(message => message.turnId));
    for (const turnId of this.summaryTurnIds) if (!workTurns.has(turnId)) this.summaryTurnIds.delete(turnId);
    if (source) {
      for (const [id, message] of this.historyMessages) this.historyMessages.set(id, summarize(message));
      this.messages = messages.map(message => this.historyMessages.get(message.id) ?? message);
    } else this.messages = [...messages];
    this.before = messages.length;
  }

  isSummaryTurn(turnId: string): boolean { return this.summaryTurnIds.has(turnId); }

  async expandTurn(turnId: string): Promise<RendererMessage[]> {
    const messages = this.source && !this.loadedTurns.has(turnId) ? await this.source.readTurn(turnId) : this.messages.filter(message => message.turnId === turnId);
    if (!messages.length) throw new Error('Claude turn is no longer available. Reload the conversation.');
    if (this.source) {
      const expected = this.messages.filter(message => message.turnId === turnId).map(message => message.id);
      if (JSON.stringify(expected) !== JSON.stringify(messages.map(message => message.id))) throw new Error('Claude history changed. Reload the conversation.');
      const indexes = new Map(this.messages.map((message, index) => [message.id, index]));
      for (const message of messages) this.messages[indexes.get(message.id)!] = message;
      for (const [id, message] of phasedHistory(messages, new Set([turnId]))) this.historyMessages.set(id, message);
    }
    this.loadedTurns.add(turnId);
    this.summaryTurnIds.delete(turnId);
    return messages.map(message => this.project(this.historyMessages.get(message.id) ?? message));
  }

  visibleMessageIds(): Set<string> { return new Set(this.visibleIds); }
  isHistoricalMessage(id: string): boolean { return this.initialIds.has(id); }
  reveal(messages: RendererMessage[]): void { for (const message of messages) this.visibleIds.add(message.id); }

  nextVisibleMessage(messageId: string, visible: Set<string>): string | undefined {
    const index = this.messages.findIndex(message => message.id === messageId);
    return this.messages.slice(index + 1).find(message => visible.has(message.id))?.id;
  }

  isCurrent(): Promise<boolean> { return this.source?.isCurrent() ?? Promise.resolve(false); }

  get hasOlder(): boolean { return this.before > 0 || Boolean(this.source?.loadEarlier); }
  get hasDeferredArchive(): boolean { return Boolean(this.source?.loadEarlier); }
  isDeferred(messageId: string): boolean { return this.contentByMessage.has(messageId); }

  takeRecoveredState(): ClaudeHistoryState | undefined {
    const state = this.recoveredState;
    this.recoveredState = undefined;
    return state;
  }

  async loadEarlier(forContinuation = false): Promise<void> {
    if (!this.source?.loadEarlier || !forContinuation && this.messages.slice(0, this.before).some(message => !this.visibleIds.has(message.id))) return;
    if (this.pendingArchive) return this.pendingArchive;
    const source = this.source;
    const pending = (async () => {
      const archive = await source.loadEarlier!();
      const original = this.messages.filter(message => this.initialIds.has(message.id));
      const split = archive.messages.length - original.length;
      if (split < 0 || archive.messages.slice(split).some((message, index) => message.id !== original[index]!.id)) {
        throw new Error('Claude history changed. Reload the conversation before loading older messages.');
      }
      const older = archive.messages.slice(0, split);
      const summaryIds = new Set(archive.turns.filter(turn => turn.status !== 'inProgress').map(turn => turn.id));
      const phased = phasedHistory(older, summaryIds);
      const workTurns = new Set([...phased.values()].filter(message => message.kind === 'steer' || message.parts.some(isWork)).map(message => message.turnId));
      for (const id of summaryIds) if (workTurns.has(id)) this.summaryTurnIds.add(id);
      for (const [id, message] of phased) { this.initialIds.add(id); this.historyMessages.set(id, summarize(message)); }
      this.messages.unshift(...older.map(message => this.historyMessages.get(message.id) ?? message));
      for (const turn of archive.turns) this.archiveTurns.set(turn.id, turn);
      this.before += older.length;
      this.source = archive.source;
      this.recoveredState = { taskPlan: archive.taskPlan, goal: archive.goal, subagentEvents: archive.subagentEvents };
    })();
    this.pendingArchive = pending;
    try { await pending; }
    finally { if (this.pendingArchive === pending) this.pendingArchive = undefined; }
  }

  pageTurns(messages: RendererMessage[]): ClaudeConversationTurn[] {
    return [...new Set(messages.map(message => message.turnId))].flatMap(id => {
      const turn = id ? this.archiveTurns.get(id) : undefined;
      return turn ? [{ ...turn, itemsView: this.isSummaryTurn(turn.id) ? 'summary' as const : 'full' as const }] : [];
    });
  }

  older(known = this.visibleIds): { messages: RendererMessage[]; hasOlder: boolean } {
    const page = this.recent(this.messages.slice(0, this.before).filter(message => !known.has(message.id)));
    this.before = page.length ? this.messages.findIndex(message => message.id === page[0]!.id) : 0;
    this.reveal(page);
    return { messages: page, hasOlder: this.hasOlder };
  }

  /** Reopening a bounded window makes its preceding history reachable again. */
  reopen(messages: RendererMessage[]): RendererMessage[] {
    this.capture(messages);
    let page = this.recent(messages);
    // A bounded reset must not advertise complete details for a turn cut by its boundary.
    while (true) {
      const included = new Set(page.map(message => message.id));
      const partial = new Set(page.filter(message => message.turnId && this.loadedTurns.has(message.turnId)
        && !this.summaryTurnIds.has(message.turnId)
        && this.messages.some(candidate => candidate.turnId === message.turnId && !included.has(candidate.id))).map(message => message.turnId!));
      if (!partial.size) break;
      for (const id of partial) this.summaryTurnIds.add(id);
      page = this.recent(messages);
    }
    this.visibleIds = new Set(page.map(message => message.id));
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
      } else if (!message.deferredContent && !this.historyMessages.has(message.id)) this.messages[index] = message;
    }
  }

  async readMessages(current: RendererMessage[]): Promise<RendererMessage[]> {
    this.capture(current);
    if (!this.source) return structuredClone(this.messages);
    const original = await this.source.readAll();
    const known = new Set(original.map(message => message.id));
    return [...original, ...structuredClone(this.messages.filter(message => !known.has(message.id)))];
  }

  private recent(messages: RendererMessage[]): RendererMessage[] {
    const page: RendererMessage[] = [];
    let bytes = 2;
    const sources = new Map(this.messages.map(message => [message.id, message]));
    for (let i = messages.length - 1; i >= 0 && page.length < pageCount; i--) {
      const source = sources.get(messages[i]!.id) ?? messages[i]!;
      const phased = this.historyMessages.get(source.id) ?? source;
      const summary = (source.role === 'assistant' || source.kind === 'steer') && this.summaryTurnIds.has(source.turnId ?? '')
        ? summarize(phased)
        : phased;
      const message = this.project(summary);
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

/** Phase the whole native turn, including segments separated by compaction or interruption. */
function phasedHistory(messages: RendererMessage[], turnIds: Set<string>): Map<string, RendererMessage> {
  const turns = new Map<string, RendererMessage[]>();
  for (const message of messages) {
    if (!message.turnId || !turnIds.has(message.turnId)) continue;
    const turn = turns.get(message.turnId) ?? [];
    turn.push(message); turns.set(message.turnId, turn);
  }
  const projected = new Map<string, RendererMessage>();
  for (const turn of turns.values()) {
    for (const message of withInferredTurnWorkPhases(turn)) {
      if (message.role === 'assistant' || message.kind === 'steer') projected.set(message.id, message);
    }
  }
  return projected;
}

function summarize(message: RendererMessage): RendererMessage {
  return { ...message, parts: message.kind === 'steer' ? [] : message.parts.filter(part => !isWork(part)) };
}

function isWork(part: RendererMessagePart): boolean {
  return part.type === 'tool' || part.type === 'reasoning' || part.type === 'text' && part.phase === 'commentary';
}
