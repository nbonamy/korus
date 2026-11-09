import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RendererMessage, RendererMessagePart, RendererToolPart } from '@workspace/core/contracts';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import { createCursorConversationReplica, emptyCursorSnapshot } from '@workspace/core/cursor-conversation-replica';
import { cursorContent, cursorToolContent } from './content';
import { record } from '../acp/acp-connection';

type Change = CursorConversationEvent extends infer Event ? Event extends CursorConversationEvent ? Omit<Event, 'agentId' | 'sessionId' | 'turnId' | 'occurredAt'> : never : never;

/** Native updates become app-owned messages here; no ACP shape reaches the renderer. */
export class CursorTranscript {
  readonly replica;
  private message?: RendererMessage;
  private readonly todoItems = new Map<string, Record<string, unknown>>();
  private replayUser: Record<string, unknown>[] = [];
  private readonly toolBodies = new Map<string,string>();
  private denied = new Set<string>();
  constructor(private readonly agentId: string, private readonly sessionId: string, private readonly changed: (event: CursorConversationEvent) => void, private readonly display: (text: string) => { text: string; parts: RendererMessagePart[]; metadata?: RendererMessage['metadata'] } = text => ({ text, parts: [] }), private readonly cwd?: string) {
    this.replica = createCursorConversationReplica(emptyCursorSnapshot(agentId, sessionId));
  }
  private event(change: Change, turnId = this.replica.getSnapshot().activeTurnId!): void {
    const event = { ...change, agentId: this.agentId, sessionId: this.sessionId, turnId, occurredAt: new Date().toISOString() } as CursorConversationEvent;
    this.replica.apply(event); this.changed(event);
  }
  start(text: string, metadata?: RendererMessage['metadata'], parts: RendererMessagePart[] = []): string {
    const turnId = randomUUID(); this.message = undefined; this.denied.clear(); this.toolBodies.clear();
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
        { const content = cursorContent(update.content);
          if (content.text !== undefined) this.text('assistant',content.text,update.sessionUpdate === 'agent_thought_chunk');
          if (content.media) { const message = this.current('assistant'); message.parts.push(content.media); this.event({type:'message.upsert',payload:{message}}); }
          return;
        }
      case 'tool_call': case 'tool_call_update': this.tool(update); return;
      // Native metadata is not proof of an implemented catalog, plan or billable usage.
      case 'session_info_update': case 'subagent_spawned': case 'subagent_state_update': return;
      case 'plan': this.progress(update); return;
      case 'user_message_chunk': case 'config_option_update': case 'available_commands_update': case 'usage_update': case 'current_mode_update': return;
      default: return;
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
  imageFile(toolCallId: string, image: {url:string;mimeType:string}): void {
    const message = this.current('assistant'), itemId = `cursor-file:${toolCallId}`;
    const part: RendererMessagePart = {type:'media',itemId,media:{...image,alt:'Image file',title:'Image file'}};
    const index = message.parts.findIndex(part=>part.type==='media' && part.itemId===itemId);
    if (index === -1) message.parts.push(part); else message.parts[index]=part;
    this.event({type:'message.upsert',payload:{message}});
  }
  request(request: import('@workspace/core/contracts').ClientRequest): void { this.event({ type: 'request.created', payload: { request } }); }
  resolved(response: import('@workspace/core/agent-request').AgentRequestResponse): void { this.event({ type: 'request.resolved', payload: response }); }
  plan(params: Record<string, unknown>): void {
    this.tool({ toolCallId: params.toolCallId, title: typeof params.name === 'string' ? params.name : 'Review plan', kind: 'plan', status: 'pending', rawInput: params, rawOutput: params.plan });
    const part = this.message?.parts.find(part => part.type === 'tool' && part.id === params.toolCallId);
    if (part?.type === 'tool') { part.metadata = { ...part.metadata, plan: params.plan, todos: params.todos, ...(typeof params.name === 'string' ? {name:params.name} : {}) }; this.event({type:'message.upsert',payload:{message:this.message!}}); }
  }
  private progress(update: Record<string, unknown>): void {
    if (!Array.isArray(update.entries) || !update.entries.every(entry => record(entry) && typeof entry.content === 'string' && ['pending','in_progress','completed'].includes(String(entry.status)))) throw new Error('Invalid Cursor plan entries.');
    const toolCallId = `cursor-plan:${this.replica.getSnapshot().activeTurnId}`;
    this.tool({toolCallId,title:'Plan progress',kind:'plan',status:'completed',rawOutput:update.entries.map(entry => `${entry.status === 'completed' ? '[x]' : '[ ]'} ${entry.content}`).join('\n')});
    const part = this.message?.parts.find(part => part.type === 'tool' && part.id === toolCallId);
    if (part?.type === 'tool') { part.metadata = {...part.metadata,source:'session-plan',planEntries:structuredClone(update.entries)}; this.event({type:'message.upsert',payload:{message:this.message!}}); }
  }
  todos(params: Record<string, unknown>): Record<string, unknown>[] {
    if (typeof params.toolCallId !== 'string' || typeof params.merge !== 'boolean' || !Array.isArray(params.todos)) throw new Error('Invalid Cursor todos.');
    const todos = params.todos.map(todo => {
      if (!record(todo) || typeof todo.id !== 'string' || typeof todo.content !== 'string' || !['pending','in_progress','completed','cancelled'].includes(String(todo.status))) throw new Error('Invalid Cursor todo.');
      return todo;
    });
    if (!params.merge) this.todoItems.clear();
    for (const todo of todos) this.todoItems.set(todo.id as string, structuredClone(todo));
    const items = [...this.todoItems.values()];
    this.tool({toolCallId:params.toolCallId,title:'Tasks',kind:'plan',status:'completed',rawOutput:items.map(todo => `${todo.status === 'completed' ? '[x]' : '[ ]'} ${todo.content}`).join('\n')});
    const part = this.message?.parts.find(part => part.type === 'tool' && part.id === params.toolCallId);
    if (part?.type === 'tool') { part.metadata = {...part.metadata,todos:items}; this.event({type:'message.upsert',payload:{message:this.message!}}); }
    return items;
  }
  planDecision(toolCallId: string, accepted: boolean): void { this.tool({toolCallId,status:accepted ? 'completed' : 'failed'}); }
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
    if (typeof update.kind === 'string') { part.kind = update.kind; part.metadata = {...part.metadata,cursorToolKind:update.kind}; }
    if (typeof update.status === 'string') part.status = update.status === 'completed' ? 'completed' : update.status === 'failed' ? 'failed' : 'running';
    if ('rawInput' in update) {
      part.input = update.rawInput;
      const input = update.rawInput;
      if (part.metadata?.cursorToolKind === 'other' && record(input) && typeof input.providerIdentifier === 'string' && input.providerIdentifier && typeof input.toolName === 'string' && input.toolName) {
        part.metadata = {...part.metadata,cursorMcpInput:input};
      } else if (part.metadata?.cursorMcpInput) {
        delete part.metadata.cursorMcpInput; delete part.metadata.server; delete part.metadata.tool;
        if (part.kind === 'mcp') part.kind = String(part.metadata.cursorToolKind ?? 'other');
      }
    }
    const mcpInput = part.metadata?.cursorMcpInput;
    if (part.metadata?.cursorToolKind === 'other' && record(mcpInput)) {
      part.kind = 'mcp'; part.input = mcpInput.args;
      part.metadata = {...part.metadata,server:mcpInput.providerIdentifier,tool:mcpInput.toolName};
    }
    if ('rawOutput' in update) { part.output = update.rawOutput; part.body = typeof update.rawOutput === 'string' ? update.rawOutput : JSON.stringify(update.rawOutput); }
    if (Array.isArray(update.content)) {
      const content = cursorToolContent(update.content,typeof part.metadata?.cursorToolKind === 'string' ? part.metadata.cursorToolKind : part.kind);
      this.toolBodies.set(update.toolCallId,content.body);
      if (content.changes.length) { part.kind = 'fileChange'; part.metadata = {...part.metadata,changes:content.changes}; }
      const prefix = `cursor-tool:${update.toolCallId}:`;
      message.parts = message.parts.filter(value => value.type !== 'media' || !value.itemId?.startsWith(prefix));
      message.parts.push(...content.media.map((value,index)=>({...value,itemId:`${prefix}${index}`})));
    }
    if (Array.isArray(part.metadata?.changes) && part.metadata.changes.length) part.kind = 'fileChange';
    const contentBody = this.toolBodies.get(update.toolCallId);
    if (contentBody) part.body = contentBody;
    if (this.denied.has(update.toolCallId) || (record(update.rawOutput) && update.rawOutput.rejected === true)) { part.status = 'failed'; part.body = 'Permission denied.'; }
    if (Array.isArray(update.locations)) {
      const locations = update.locations.map(value => { if (!record(value) || typeof value.path !== 'string' || (value.line !== undefined && (typeof value.line !== 'number' || !Number.isSafeInteger(value.line) || value.line < 0))) throw new Error('Invalid Cursor tool location.'); return {path:value.path,...(typeof value.line === 'number' ? {line:value.line} : {})}; });
      part.metadata = {...part.metadata,locations};
    }
    part.metadata = { ...part.metadata, ...(this.cwd ? {cwd:this.cwd} : {}) };
    if (part.kind === 'fileChange' || part.kind === 'mcp') delete part.metadata.displayTitle; else part.metadata.displayTitle = part.title;
    if (part.kind === 'fileChange' && Array.isArray(part.metadata.changes)) {
      const changes = part.metadata.changes.filter((change): change is Record<string,unknown> => record(change) && typeof change.path === 'string');
      const action = changes.every(change=>change.kind==='add') ? 'create' : changes.every(change=>change.kind==='delete') ? 'delete' : 'edit';
      part.statusText = JSON.stringify({source:'cursor',action,phase:part.status,params:{target:changes.map(change=>path.basename(change.path as string)).join(', '),...(changes.length===1 ? {path:changes[0]!.path} : {})}});
    }
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
