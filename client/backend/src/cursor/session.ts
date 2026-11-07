import { randomUUID } from 'node:crypto';
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { product } from '@workspace/core/product';
import type { RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import { AcpConnection, record } from '../acp/acp-connection';
import { cursorEnvironment, resolveCursorExecutable, type CursorRuntime, cursorRuntime } from './runtime';
import { CursorPromptJournal } from './prompt-journal';
import { CursorTranscript } from './transcript';

const teamSwitched = 'Your team has switched. Reconnect Cursor in Settings.';
const policyDenied = 'Cursor ACP is blocked by your team policy. Contact your administrator.';
type Options = { agentId: string; cwd: string; runtime?: CursorRuntime; sessionId?: string; catalogOnly?: boolean; mcpServers?: unknown[]; signal: AbortSignal; changed(event: CursorConversationEvent): void; disconnected(error: Error): void };

/** One agent/session; framing, request deadlines and process teardown remain in the shared transport. */
export class CursorSession {
  private connection!: AcpConnection;
  private transcript!: CursorTranscript;
  private readonly pending = new Map<string, { resolve(value: unknown): void; answer(response: AgentRequestResponse): unknown }>();
  private journal!: CursorPromptJournal;
  private config: Record<string, unknown> = {};
  private loading = true;
  private disposed = false;
  private closing = false;
  private interrupted = false;
  private active?: Promise<void>;
  private readonly startupUpdates: unknown[] = [];
  private constructor(private readonly options: Options) {}
  static async open(options: Options): Promise<CursorSession> {
    const session = new CursorSession(options);
    const command = resolveCursorExecutable();
    if (!command) throw new Error('Install the Cursor CLI in Settings.');
    session.connection = new AcpConnection({ command, args: ['acp'], displayName: 'Cursor', cwd: options.cwd, env: cursorEnvironment(false, options.runtime),
      onRequest: (method, params) => session.request(method, params), onNotification: (method, params) => session.notification(method, params), onClose: error => session.failed(error),
      stderrErrorMarkers: [{ marker: 'Your team has switched', message: teamSwitched },
        { marker: 'Headless ACP use is disabled', message: policyDenied }, { marker: 'ACP is disabled', message: policyDenied },
        { marker: 'Headless mode is disabled', message: policyDenied }],
      formatRpcError: (code, message) => typeof message === 'string' && /your team has switched/i.test(message) ? teamSwitched
        : typeof message === 'string' && /(?:headless|acp).*(?:disabled|blocked|not allowed|policy)/i.test(message) ? policyDenied
        : `Cursor ACP request failed (${code}). Reconnect Cursor in Settings.`,
    });
    const abort = () => { void session.close(); };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal.aborted) throw new Error('Cursor session startup cancelled.');
      session.connection.start();
      const initialized = await session.connection.request('initialize', { protocolVersion: 1, clientInfo: { name: product.mcpServerName, version: '1' }, clientCapabilities: { _meta: { parameterizedModelPicker: true } } });
      if (!record(initialized) || initialized.protocolVersion !== 1 || !Array.isArray(initialized.authMethods) || !initialized.authMethods.some(method => record(method) && method.id === 'cursor_login')) throw new Error('Unsupported Cursor ACP handshake.');
      if (!record(initialized.agentCapabilities) || !record(initialized.agentCapabilities.sessionCapabilities) || !record(initialized.agentCapabilities.sessionCapabilities.list)) throw new Error('Cursor ACP lacks session/list support required for safe cancellation.');
      await session.connection.request('authenticate', { methodId: 'cursor_login' });
      if (options.catalogOnly) { session.transcript = new CursorTranscript(options.agentId, 'catalog', () => {}); session.loading = false; return session; }
      if (options.sessionId) {
        if (initialized.agentCapabilities.loadSession !== true) throw new Error('Cursor does not support history loading.');
        const catalog = await session.connection.request('session/list', { cwd: options.cwd });
        if (!record(catalog) || !Array.isArray(catalog.sessions) || catalog.sessions.length > 10_000) throw new Error('Invalid Cursor history catalog.');
        const entry = catalog.sessions.find(value => record(value) && value.sessionId === options.sessionId);
        if (!record(entry) || typeof entry.cwd !== 'string' || !path.isAbsolute(entry.cwd) || await realpath(entry.cwd).catch(() => null) !== await realpath(options.cwd)) throw new Error('Cursor conversation is missing or belongs to another workspace.');
        session.journal = await CursorPromptJournal.open(options.runtime?.homePath ?? cursorRuntime().homePath, options.sessionId);
        session.transcript = new CursorTranscript(options.agentId, options.sessionId, () => {}, text => session.journal.display(text));
      }
      const created = await session.connection.request(options.sessionId ? 'session/load' : 'session/new', { ...(options.sessionId ? { sessionId: options.sessionId } : {}), cwd: options.cwd, mcpServers: options.mcpServers ?? [] });
      if (!record(created) || (!options.sessionId && (typeof created.sessionId !== 'string' || !created.sessionId)) || (options.sessionId && created.sessionId !== undefined && created.sessionId !== options.sessionId)) throw new Error('Invalid Cursor session identity.');
      session.config = created;
      session.journal ??= await CursorPromptJournal.open(options.runtime?.homePath ?? cursorRuntime().homePath, created.sessionId as string);
      if (!options.sessionId) session.transcript = new CursorTranscript(options.agentId, created.sessionId as string, event => { if (!session.loading) options.changed(event); });
      // Rebind replay without publishing its synthetic lifecycle as live execution.
      if (options.sessionId) {
        session.transcript.finishReplay();
        const replay = session.snapshot;
        session.transcript = new CursorTranscript(options.agentId, options.sessionId, options.changed);
        session.transcript.replica.replace(replay);
      }
      for (const params of session.startupUpdates) session.notification('session/update', params);
      session.startupUpdates.length = 0;
      session.loading = false;
      return session;
    } catch (error) { await session.close(); throw error; }
    finally { options.signal.removeEventListener('abort', abort); }
  }
  static async list(options: Options): Promise<{ sessionId: string; cwd: string; title: string }[]> {
    const session = await CursorSession.open({ ...options, catalogOnly: true });
    const abort = () => { void session.close(); };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      if (options.signal.aborted) throw new Error('Cursor history operation was released.');
      const result = await session.connection.request('session/list', { cwd: options.cwd });
      if (!record(result) || !Array.isArray(result.sessions) || result.sessions.length > 10_000) throw new Error('Invalid Cursor history catalog.');
      return result.sessions.map(entry => {
        if (!record(entry) || typeof entry.sessionId !== 'string' || !entry.sessionId || typeof entry.cwd !== 'string' || !path.isAbsolute(entry.cwd)) throw new Error('Invalid Cursor history entry.');
        return { sessionId: entry.sessionId, cwd: entry.cwd, title: typeof entry.title === 'string' ? entry.title : entry.sessionId };
      });
    } finally { options.signal.removeEventListener('abort', abort); await session.close(); }
  }
  get configuration() { return this.config; }
  async setModel(model: string): Promise<void> {
    const result = await this.connection.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: model });
    if (!record(result) || !Array.isArray(result.configOptions)) throw new Error('Invalid Cursor model response.');
    this.config = { ...this.config, configOptions: result.configOptions };
  }
  get snapshot() { return this.transcript.replica.getSnapshot(); }
  get sessionId() { return this.snapshot.sessionId; }
  get isClosed() { return this.disposed; }
  get cwd() { return this.options.cwd; }
  prompt(text: string, wireText: string, metadata?: RendererMessage['metadata'], attachments: unknown[] = [], parts: RendererMessagePart[] = []): { turnId: string; completion: Promise<void> } {
    if (this.disposed || this.active) throw new Error('Cursor session is closed or still finishing a turn.');
    this.interrupted = false;
    const turnId = this.transcript.start(text, metadata, parts);
    const completion = this.journal.append({wireText, text, parts, ...(metadata ? {metadata} : {})}).then(() => {
      if (this.disposed || this.interrupted) throw new Error('Cursor prompt was cancelled before admission.');
      return this.connection.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: wireText }, ...attachments] }, 30 * 60_000);
    }).then(async result => {
      if (!record(result) || typeof result.stopReason !== 'string' || !['end_turn', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason)) throw new Error('Invalid Cursor turn completion.');
      const status = this.interrupted || result.stopReason === 'cancelled' ? 'interrupted' : result.stopReason === 'end_turn' ? 'completed' : 'failed';
      if (status === 'interrupted') {
        this.interrupted = true;
        // The qualified CLI supports session/list. Its response fences buffered
        // cancellation output before the next prompt; no history is retained.
        await this.connection.request('session/list', { cwd: this.options.cwd }, 5_000);
      }
      this.cancelRequests();
      this.transcript.finish(turnId, status, status === 'failed' ? `Cursor stopped: ${result.stopReason}.` : undefined);
    }).catch(error => {
      if (this.interrupted) { this.transcript.finish(turnId, 'interrupted'); if (!this.closing) this.failed(error instanceof Error ? error : new Error('Cursor cancellation failed.')); }
      else this.failed(error instanceof Error ? error : new Error('Cursor turn failed.'));
    }).finally(() => { if (this.active === completion) this.active = undefined; });
    this.active = completion;
    return { turnId, completion };
  }
  async interrupt(expectedTurnId?: string): Promise<void> {
    if (!this.active) return;
    if (expectedTurnId && expectedTurnId !== this.snapshot.activeTurnId) throw new Error('Cursor turn changed before cancellation.');
    this.interrupted = true;
    this.cancelRequests();
    if (!this.disposed) this.connection.notify('session/cancel', { sessionId: this.sessionId });
    const timer = setTimeout(() => { void this.close(); }, 5_000);
    try { await this.active; } finally { clearTimeout(timer); }
  }
  async close(): Promise<void> {
    this.cancelRequests();
    const turnId = this.transcript?.replica.getSnapshot().activeTurnId;
    if (turnId) { this.interrupted = true; this.transcript.finish(turnId, 'interrupted'); }
    this.closing = true; this.disposed = true;
    await this.connection.close(); await this.active;
  }
  private notification(method: string, params: unknown): void {
    if (method !== 'session/update') return;
    if (!this.transcript && record(params) && record(params.update) && ['config_option_update', 'available_commands_update', 'current_mode_update'].includes(String(params.update.sessionUpdate))) {
      if (this.startupUpdates.length >= 256) throw new Error('Cursor startup update limit exceeded.');
      this.startupUpdates.push(params); return;
    }
    if (!this.transcript || !record(params) || params.sessionId !== this.sessionId || !record(params.update)) throw new Error('Invalid Cursor update identity.');
    if (this.disposed || this.interrupted) return;
    if (params.update.sessionUpdate === 'config_option_update') this.config = { ...this.config, configOptions: params.update.configOptions };
    if (this.loading) this.transcript.replay(params.update);
    else this.transcript.update(params.update);
  }
  respond(response: AgentRequestResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending || (response.agentId && response.agentId !== this.options.agentId) || this.disposed || this.interrupted) throw new Error('Cursor request is no longer pending.');
    const result = pending.answer(response);
    this.pending.delete(response.id); this.transcript.resolved(response); pending.resolve(result);
  }
  private cancelRequests(): void {
    for (const [id, pending] of this.pending) { this.pending.delete(id); this.transcript.resolved({id,outcome:{kind:'cancelled'}}); pending.resolve({outcome:{outcome:'cancelled'}}); }
  }
  private async request(method: string, params: unknown): Promise<unknown> {
    const cancelled = { outcome: { outcome: 'cancelled' } };
    if (!this.transcript || this.loading || this.disposed || this.interrupted || !this.snapshot.busy || !record(params)) return cancelled;
    const permission = method === 'session/request_permission';
    const plan = method === 'cursor/create_plan';
    if (!permission && !plan) {
      if (method.startsWith('cursor/')) return cancelled;
      throw new Error('Unsupported Cursor client request.');
    }
    if (permission && (params.sessionId !== this.sessionId || !record(params.toolCall) || typeof params.toolCall.toolCallId !== 'string')) return cancelled;
    if (plan && (typeof params.toolCallId !== 'string' || typeof params.plan !== 'string' || !Array.isArray(params.todos))) return cancelled;
    if (plan) this.transcript.plan(params);
    const id = randomUUID();
    const call = permission ? params.toolCall as Record<string, unknown> : params;
    return new Promise(resolve => {
      this.pending.set(id, { resolve, answer: response => {
        if (response.outcome.kind === 'cancelled') return cancelled;
        if (response.outcome.kind !== 'decision' || !['allow', 'deny'].includes(response.outcome.decision)) throw new Error('Cursor requires a once-only decision.');
        const allowed = response.outcome.decision === 'allow';
        if (plan) { this.transcript.planDecision(params.toolCallId as string, allowed); return { outcome: { outcome: allowed ? 'accepted' : 'rejected' } }; }
        const option = Array.isArray(params.options) ? params.options.find(option => record(option) && option.kind === (allowed ? 'allow_once' : 'reject_once') && typeof option.optionId === 'string') : undefined;
        if (!allowed) this.transcript.deny(call);
        return record(option) ? { outcome: { outcome: 'selected', optionId: option.optionId } } : cancelled;
      } });
      this.transcript.request({ id, kind: 'confirm_tool', payload: { confirmation: { integrationId: 'cursor', integrationName: 'Cursor', toolName: plan ? 'create_plan' : String(call.kind ?? 'tool'), summary: typeof call.title === 'string' ? call.title : plan ? 'Review Cursor plan' : 'Approve Cursor tool', argumentsPreview: plan ? params.plan as string : JSON.stringify(call.rawInput ?? call), allowConversation: false, allowAlways: false } } });
    });
  }
  private failed(error: Error): void {
    if (this.disposed) return;
    this.cancelRequests();
    this.disposed = true;
    const turnId = this.transcript?.replica.getSnapshot().activeTurnId;
    if (turnId) this.transcript.finish(turnId, this.interrupted ? 'interrupted' : 'failed', this.interrupted ? undefined : error.message);
    if (!this.closing) this.options.disconnected(error);
    void this.connection.close();
  }
}
