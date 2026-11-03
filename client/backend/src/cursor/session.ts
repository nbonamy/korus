import { product } from '@workspace/core/product';
import type { RendererMessage } from '@workspace/core/contracts';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import { AcpConnection, record } from '../acp/acp-connection';
import { cursorEnvironment, resolveCursorExecutable } from './runtime';
import { CursorTranscript } from './transcript';

const teamSwitched = 'Your team has switched. Reconnect Cursor in Settings.';
const policyDenied = 'Cursor ACP is blocked by your team policy. Contact your administrator.';
type Options = { agentId: string; cwd: string; signal: AbortSignal; changed(event: CursorConversationEvent): void; disconnected(error: Error): void };

/** One agent/session; framing, request deadlines and process teardown remain in the shared transport. */
export class CursorSession {
  private connection!: AcpConnection;
  private transcript!: CursorTranscript;
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
    session.connection = new AcpConnection({ command, args: ['acp'], displayName: 'Cursor', cwd: options.cwd, env: cursorEnvironment(),
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
      const created = await session.connection.request('session/new', { cwd: options.cwd, mcpServers: [] });
      if (!record(created) || typeof created.sessionId !== 'string' || !created.sessionId) throw new Error('Invalid Cursor session identity.');
      session.transcript = new CursorTranscript(options.agentId, created.sessionId, options.changed);
      for (const params of session.startupUpdates) session.notification('session/update', params);
      session.startupUpdates.length = 0;
      return session;
    } catch (error) { await session.close(); throw error; }
    finally { options.signal.removeEventListener('abort', abort); }
  }
  get snapshot() { return this.transcript.replica.getSnapshot(); }
  get sessionId() { return this.snapshot.sessionId; }
  get isClosed() { return this.disposed; }
  get cwd() { return this.options.cwd; }
  prompt(text: string, wireText: string, metadata?: RendererMessage['metadata']): { turnId: string; completion: Promise<void> } {
    if (this.disposed || this.active) throw new Error('Cursor session is closed or still finishing a turn.');
    this.interrupted = false;
    const turnId = this.transcript.start(text, metadata);
    const completion = this.connection.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: wireText }] }, 30 * 60_000).then(async result => {
      if (!record(result) || typeof result.stopReason !== 'string' || !['end_turn', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason)) throw new Error('Invalid Cursor turn completion.');
      const status = this.interrupted || result.stopReason === 'cancelled' ? 'interrupted' : result.stopReason === 'end_turn' ? 'completed' : 'failed';
      if (status === 'interrupted') {
        this.interrupted = true;
        // The qualified CLI supports session/list. Its response fences buffered
        // cancellation output before the next prompt; no history is retained.
        await this.connection.request('session/list', { cwd: this.options.cwd }, 5_000);
      }
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
    if (!this.disposed) this.connection.notify('session/cancel', { sessionId: this.sessionId });
    const timer = setTimeout(() => { void this.close(); }, 5_000);
    try { await this.active; } finally { clearTimeout(timer); }
  }
  async close(): Promise<void> {
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
    this.transcript.update(params.update);
  }
  private async request(method: string, params: unknown): Promise<unknown> {
    if (method.startsWith('cursor/')) return { outcome: { outcome: 'cancelled' } };
    if (method === 'session/request_permission') {
      if (!record(params) || !this.transcript || params.sessionId !== this.sessionId || this.disposed || !this.snapshot.busy || this.interrupted) return { outcome: { outcome: 'cancelled' } };
      if (!record(params.toolCall) || typeof params.toolCall.toolCallId !== 'string') return { outcome: { outcome: 'cancelled' } };
      this.transcript.deny(params.toolCall);
      const rejected = Array.isArray(params.options) ? params.options.find(option => record(option) && option.kind === 'reject_once' && typeof option.optionId === 'string') : undefined;
      return record(rejected) ? { outcome: { outcome: 'selected', optionId: rejected.optionId } } : { outcome: { outcome: 'cancelled' } };
    }
    throw new Error('Unsupported Cursor client request.');
  }
  private failed(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    const turnId = this.transcript?.replica.getSnapshot().activeTurnId;
    if (turnId) this.transcript.finish(turnId, this.interrupted ? 'interrupted' : 'failed', this.interrupted ? undefined : error.message);
    if (!this.closing) this.options.disconnected(error);
    void this.connection.close();
  }
}
