import { randomUUID } from 'node:crypto';
import type { RendererMessage, RendererMessagePart, RendererToolPart } from '@workspace/core/contracts';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import { createCursorConversationReplica, emptyCursorSnapshot } from '@workspace/core/cursor-conversation-replica';
import { record } from '../acp/acp-connection';

type Change = CursorConversationEvent extends infer Event ? Event extends CursorConversationEvent ? Omit<Event, 'agentId' | 'sessionId' | 'turnId' | 'occurredAt'> : never : never;

/** Native updates become app-owned messages here; no ACP shape reaches the renderer. */
export class CursorTranscript {
  readonly replica;
  private message?: RendererMessage;
  private replayUser: Record<string, unknown>[] = [];
  private denied = new Set<string>();
  constructor(private readonly agentId: string, private readonly sessionId: string, private readonly changed: (event: CursorConversationEvent) => void, private readonly display: (text: string) => { text: string; parts: RendererMessagePart[]; metadata?: RendererMessage['metadata'] } = text => ({ text, parts: [] })) {
    this.replica = createCursorConversationReplica(emptyCursorSnapshot(agentId, sessionId));
  }
  private event(change: Change, turnId = this.replica.getSnapshot().activeTurnId!): void {
    const event = { ...change, agentId: this.agentId, sessionId: this.sessionId, turnId, occurredAt: new Date().toISOString() } as CursorConversationEvent;
    this.replica.apply(event); this.changed(event);
  }
  start(text: string, metadata?: RendererMessage['metadata'], parts: RendererMessagePart[] = []): string {
    const turnId = randomUUID(); this.message = undefined; this.denied.clear();
    this.event({ type: 'turn.started', payload: { turn: { id: turnId } } }, turnId);
    this.text('user', text, false, metadata);
    if (parts.length) { this.message!.parts.push(...structuredClone(parts)); this.event({ type: 'message.upsert', payload: { message: this.message! } }); }
    return turnId;
  }
  finish(turnId: string, status: 'completed' | 'interrupted' | 'failed', error?: string): void {
    if (this.replica.getSnapshot().activeTurnId !== turnId) return;
    for (const value of this.replica.getSnapshot().messages.filter(message => message.turnId === turnId)) {
      const message = structuredClone(value);
      let changed = false;
      for (const part of message.parts) if (part.type === 'tool' && part.status === 'running') {
        part.status = 'failed'; part.body ??= status === 'interrupted' ? 'Interrupted.' : 'Tool completion was not reported.'; changed = true;
      }
      if (changed) this.event({ type: 'message.upsert', payload: { message } });
    }
    this.event({ type: 'turn.completed', payload: { turn: { id: turnId, status }, ...(error ? { error } : {}) } }, turnId);
    this.message = undefined;
  }
  update(update: Record<string, unknown>): void {
    if (!this.replica.getSnapshot().busy) return;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk':
        if (!record(update.content) || update.content.type !== 'text' || typeof update.content.text !== 'string') throw new Error('Invalid Cursor text update.');
        this.text('assistant', update.content.text, update.sessionUpdate === 'agent_thought_chunk'); return;
      case 'tool_call': case 'tool_call_update': this.tool(update); return;
      // Native metadata is not proof of an implemented catalog, plan or billable usage.
      case 'user_message_chunk': case 'config_option_update': case 'available_commands_update': case 'plan': case 'usage_update': case 'current_mode_update': return;
      default: throw new Error('Unsupported Cursor session update.');
    }
  }
  replay(update: Record<string, unknown>): void {
    if (update.sessionUpdate === 'user_message_chunk') {
      if (!record(update.content)) throw new Error('Invalid Cursor replay prompt.');
      this.replayUser.push(update.content); return;
    }
    this.flushReplayUser();
    if (!this.replica.getSnapshot().busy && ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(String(update.sessionUpdate))) this.start('');
    this.update(update);
  }
  private flushReplayUser(): void {
    if (!this.replayUser.length) return;
    const blocks = this.replayUser; this.replayUser = [];
    const active = this.replica.getSnapshot().activeTurnId;
    if (active) this.finish(active, 'completed');
    const nativeText = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
    const presentation = this.display(nativeText);
    const parts = presentation.parts.length ? presentation.parts : blocks.flatMap((block): RendererMessagePart[] => {
      if (block.type === 'image' && typeof block.mimeType === 'string' && typeof block.data === 'string') return [{ type: 'attachment', attachment: { kind: 'image', name: 'Image', mimeType: block.mimeType, url: `data:${block.mimeType};base64,${block.data}` } }];
      if (block.type === 'resource' && record(block.resource) && typeof block.resource.uri === 'string') return [{ type: 'attachment', attachment: { kind: 'file', name: typeof block.resource.name === 'string' ? block.resource.name : block.resource.uri, url: block.resource.uri } }];
      return [];
    });
    this.start(presentation.text, presentation.metadata, parts);
  }
  finishReplay(): void {
    this.flushReplayUser();
    const active = this.replica.getSnapshot().activeTurnId;
    if (active) this.finish(active, 'completed');
    const snapshot = structuredClone(this.replica.getSnapshot());
    for (const turn of snapshot.turns) { turn.startedAt = null; turn.completedAt = null; turn.durationMs = null; }
    for (const message of snapshot.messages) message.createdAt = '';
    this.replica.replace(snapshot);
  }
  deny(toolCall: unknown): void {
    if (!record(toolCall) || typeof toolCall.toolCallId !== 'string') throw new Error('Invalid Cursor permission tool identity.');
    this.denied.add(toolCall.toolCallId);
    this.tool({ ...toolCall, status: 'failed', rawOutput: { rejected: true }, content: [{ type: 'content', content: { type: 'text', text: 'Permission denied.' } }] });
  }
  private text(role: 'user' | 'assistant', text: string, thought: boolean, metadata?: RendererMessage['metadata']): void {
    const message = this.current(role); const last = message.parts.at(-1);
    if (metadata) message.metadata = metadata;
    if (thought) {
      if (last?.type === 'reasoning') last.summary += text;
      else message.parts.push({ type: 'reasoning', summary: text, itemId: randomUUID(), summaryIndex: 0 });
    } else if (last?.type === 'text') last.text += text;
    else message.parts.push({ type: 'text', text });
    this.event({ type: 'message.upsert', payload: { message } });
  }
  private tool(update: Record<string, unknown>): void {
    if (typeof update.toolCallId !== 'string') throw new Error('Invalid Cursor tool identity.');
    const existing = this.replica.getSnapshot().messages.find(message => message.turnId === this.replica.getSnapshot().activeTurnId && message.parts.some(part => part.type === 'tool' && part.id === update.toolCallId));
    const message = existing ? structuredClone(existing) : this.current('assistant');
    const previous = message.parts.find((part): part is RendererToolPart => part.type === 'tool' && part.id === update.toolCallId);
    const part = previous ?? { type: 'tool' as const, id: update.toolCallId, kind: 'tool', title: 'Cursor tool', status: 'running' as const };
    if (typeof update.title === 'string') part.title = update.title;
    if (typeof update.kind === 'string') part.kind = update.kind;
    if (typeof update.status === 'string') part.status = update.status === 'completed' ? 'completed' : update.status === 'failed' ? 'failed' : 'running';
    if ('rawInput' in update) part.input = update.rawInput;
    if ('rawOutput' in update) { part.output = update.rawOutput; part.body = typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput); }
    if (Array.isArray(update.content)) {
      const text = update.content.flatMap(item => record(item) && record(item.content) && typeof item.content.text === 'string' ? [item.content.text] : []).join('\n');
      if (text) part.body = text;
    }
    if (this.denied.has(update.toolCallId) || (record(update.rawOutput) && update.rawOutput.rejected === true)) { part.status = 'failed'; part.body = 'Permission denied.'; }
    part.metadata = { ...part.metadata, displayTitle: part.title };
    if (!previous) message.parts.push(part);
    if (message.id === this.message?.id) this.message = message;
    this.event({ type: 'message.upsert', payload: { message } });
  }
  private current(role: 'user' | 'assistant'): RendererMessage {
    if (this.message?.role !== role) this.message = { id: randomUUID(), agentId: this.agentId, turnId: this.replica.getSnapshot().activeTurnId!, role,
      parts: [], status: role === 'user' ? 'complete' : 'streaming', createdAt: new Date().toISOString() };
    return this.message;
  }
}
