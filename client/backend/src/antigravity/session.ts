import path from 'node:path';
import type { AgentRequestResponse } from '@workspace/core/agent-request';
import type { AntigravityConversationEvent, AntigravityConversationSnapshot } from '@workspace/core/contracts/antigravity-conversation';
import { AcpRuntime } from './acp-runtime';
import { record } from './acp-connection';
import { antigravityHome } from './runtime';
import { AcpTranscript } from './transcript';
import { permissionRequest } from './permissions';
import { handleAcpFileRequest } from './filesystem';
import { validateAcpSession } from './catalog';
import { AcpPromptJournal } from './prompt-journal';
import type { RendererMessagePart } from '@workspace/core/contracts';
import type { ExecutionObservation } from '@workspace/core/usage';
import { product } from '@workspace/core/product';

type SessionOptions = {
  agentId: string; cwd: string; home?: string; sessionId?: string;
  mcpServers: unknown[];
  tools?: boolean;
  /** Not a user conversation: persist no prompts and hide it from history. */
  ephemeral?: boolean;
  changed(event: AntigravityConversationEvent): void;
  requestChanged?(event: AntigravityConversationEvent): void;
  closed?(error: Error): void;
  usage?(event: ExecutionObservation): void;
};
type PendingPermission = ReturnType<typeof permissionRequest> & { resolve(value: unknown): void };

/** One agent owns one runtime/session. Concurrent prompts are rejected before ACP admission. */
export class AcpSession {
  private runtime!: AcpRuntime;
  private transcript!: AcpTranscript;
  private initialization: unknown[] = [];
  private loading = true;
  private disposed = false;
  private interrupted = false;
  private promptSent = false;
  private active?: Promise<void>;
  private readonly pending = new Map<string, PendingPermission>();
  private config: Record<string, unknown> = {};
  private journal!: AcpPromptJournal;
  private planMarkdown?: string;
  private constructor(private readonly options: SessionOptions) {}

  static async open(options: SessionOptions): Promise<AcpSession> {
    const session = new AcpSession(options);
    try {
      session.runtime = await AcpRuntime.open({ cwd: options.cwd, home: options.home, filesystem: options.tools !== false,
        onRequest: (method, params) => session.request(method, params),
        onNotification: (method, params) => session.notification(method, params),
        onClose: error => session.closed(error),
      });
      await session.runtime.authenticate();
      if (options.sessionId) await validateAcpSession(session.runtime.connection, options.sessionId, options.cwd);
      const result = await session.runtime.connection.request(options.sessionId ? 'session/load' : 'session/new', {
        ...(options.sessionId ? { sessionId: options.sessionId } : {}), cwd: options.cwd, mcpServers: options.mcpServers,
        ...(options.tools === false ? { _meta: { agy: { enabledTools: [] } } } : {}),
      }, 120_000);
      if (!record(result)) throw new Error('Invalid Antigravity session response.');
      const id = options.sessionId ?? result.sessionId;
      if (typeof id !== 'string' || !id || (result.sessionId !== undefined && result.sessionId !== id)) throw new Error('Antigravity session identity mismatch.');
      session.config = result;
      const home = options.home ?? antigravityHome();
      session.journal = options.ephemeral ? await AcpPromptJournal.ephemeral(home, id) : await AcpPromptJournal.open(home, id);
      session.transcript = new AcpTranscript(options.agentId, id, event => {
        if (!session.loading) {
          options.changed(event);
          if (event.type === 'request.created' || event.type === 'request.resolved') options.requestChanged?.(event);
        }
      }, text => session.journal.display(text));
      for (const params of session.initialization) session.update(params);
      session.initialization = [];
      session.transcript.finish('completed');
      session.loading = false;
      return session;
    } catch (error) { await session.close(); throw error; }
  }

  get snapshot(): AntigravityConversationSnapshot { return this.transcript.replica.getSnapshot(); }
  get configuration(): Record<string, unknown> { return this.config; }
  get sessionId(): string { return this.snapshot.sessionId; }
  get isClosed(): boolean { return this.disposed; }
  get cwd(): string { return this.options.cwd; }
  get writtenPlan(): string | undefined { return this.planMarkdown; }

  prompt(text: string, content: unknown[] = [{ type: 'text', text }], parts: RendererMessagePart[] = [], metadata?: import('@workspace/core/contracts').RendererMessage['metadata']): { turnId: string; completion: Promise<void> } {
    if (this.disposed) throw new Error('Antigravity session is closed.');
    if (this.active) throw new Error('Antigravity is still finishing the previous turn. Queue the next prompt.');
    this.interrupted = false;
    this.promptSent = false;
    this.planMarkdown = undefined;
    const turnId = this.transcript.start(text, parts, metadata);
    const wireText = record(content[0]) && typeof content[0].text === 'string' ? content[0].text : text;
    let startedAt: number | undefined;
    let outcome: "completed" | "failed" | "interrupted" = "failed";
    const observe = (
      phase: "started" | "completed" | "failed" | "interrupted",
    ) => {
      try {
        this.options.usage?.({
          provider: "antigravity",
          agentId: this.options.agentId,
          sessionId: this.sessionId,
          turnId,
          phase,
          at: Date.now(),
          model: null,
          tokens: null,
          // Qualified ACP reports context occupancy and selected settings, not
          // billable request identities/categories or the model/tier served.
          requestCoverage: "partial",
          requestCoverageReason: "acp-request-evidence-unavailable",
          ...(phase !== "started" && startedAt !== undefined
            ? { durationMs: Math.max(0, Date.now() - startedAt) }
            : {}),
        });
      } catch {
        /* Numeric observation must not change ACP execution. */
      }
    };
    const completion = this.journal.append({ wireText, text, parts, ...(metadata ? { metadata } : {}) }).then(() => {
      if (this.interrupted) return { stopReason: 'cancelled' };
      this.promptSent = true;
      startedAt = Date.now();
      observe('started');
      return this.runtime.connection.request('session/prompt', { sessionId: this.sessionId, prompt: content }, 30 * 60_000);
    })
      .then(result => {
        if (!record(result) || typeof result.stopReason !== 'string') throw new Error('Invalid Antigravity turn completion.');
        const status = this.interrupted || result.stopReason === 'cancelled' ? 'interrupted'
          : result.stopReason === 'end_turn' ? 'completed' : 'failed';
        outcome = status;
        this.transcript.finish(status, status === 'failed' ? `Antigravity stopped: ${result.stopReason}.` : undefined);
      }).catch(error => {
        outcome = this.interrupted ? 'interrupted' : 'failed';
        this.transcript.finish(this.interrupted ? 'interrupted' : 'failed', this.interrupted ? undefined : safeError(error));
      }).finally(() => {
        if (startedAt !== undefined) observe(outcome);
        this.cancelPermissions();
        if (this.active === completion) this.active = undefined;
      });
    this.active = completion;
    return { turnId, completion };
  }

  async interrupt(expectedTurnId?: string): Promise<void> {
    if (!this.active) return;
    if (expectedTurnId && expectedTurnId !== this.snapshot.activeTurnId) throw new Error('Antigravity turn changed before cancellation.');
    this.interrupted = true;
    this.cancelPermissions();
    if (this.promptSent) this.runtime.connection.notify('session/cancel', { sessionId: this.sessionId });
    const timer = setTimeout(() => { void this.runtime.close(); }, 5_000);
    try { await this.active; } finally { clearTimeout(timer); }
  }

  respond(response: AgentRequestResponse): void {
    if (response.agentId && response.agentId !== this.options.agentId) throw new Error('Antigravity request belongs to another agent.');
    const pending = this.pending.get(response.id);
    if (!pending) throw new Error('Antigravity request is no longer pending.');
    const result = pending.answer(response);
    this.pending.delete(response.id);
    this.transcript.event({ type: 'request.resolved', payload: { id: response.id, outcome: response.outcome } });
    pending.resolve(result);
  }

  async setModel(model: string): Promise<void> {
    this.assertIdle();
    const result = await this.runtime.connection.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: model });
    if (record(result)) this.config = { ...this.config, ...result };
  }

  async setMode(modeId: string): Promise<void> {
    this.assertIdle();
    if (!['default', 'auto_edit'].includes(modeId)) throw new Error('Unsupported Antigravity permission mode.');
    await this.runtime.connection.request('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  async close(): Promise<void> {
    this.disposed = true;
    this.cancelPermissions();
    await this.runtime?.close();
    await this.active;
  }

  private assertIdle(): void {
    if (this.disposed || this.active) throw new Error('Antigravity session must be idle to change settings.');
  }

  private notification(method: string, params: unknown): void {
    if (method !== 'session/update') return;
    if (!this.transcript) {
      if (this.initialization.length >= 50_000) throw new Error('Antigravity replay exceeds the supported history limit.');
      this.initialization.push(params); return;
    }
    this.update(params);
  }

  private update(params: unknown): void {
    if (!record(params) || params.sessionId !== this.sessionId || !record(params.update)) throw new Error('Antigravity update identity mismatch.');
    if (this.disposed) return;
    this.transcript.update(params.update, this.loading);
    if (params.update.sessionUpdate === 'config_option_update') this.config = { ...this.config, configOptions: params.update.configOptions };
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!record(params) || !this.transcript || params.sessionId !== this.sessionId || this.disposed || this.loading) throw new Error('Antigravity client request is outside an active session.');
    if (this.options.tools === false) {
      if (method === 'session/request_permission') return { outcome: { outcome: 'cancelled' } };
      throw new Error('Tools are unavailable during text generation.');
    }
    if (method === 'session/request_permission') {
      if (!this.active) throw new Error('Antigravity permission request has no active turn.');
      if (this.interrupted) return { outcome: { outcome: 'cancelled' } };
      const sessionHasKorusMcp = this.options.mcpServers.some(server => record(server) && server.name === product.mcpServerName);
      const pending = permissionRequest(params, sessionHasKorusMcp);
      if (pending.automaticResponse) return pending.automaticResponse;
      return new Promise(resolve => {
        this.pending.set(pending.request.id, { ...pending, resolve });
        this.transcript.event({ type: 'request.created', payload: { request: pending.request } });
      });
    }
    if (!this.active) throw new Error('Antigravity file request has no active turn.');
    const result = await handleAcpFileRequest(method, params, [this.options.cwd,
      path.join(this.options.home ?? antigravityHome(), 'antigravity-acp', 'brain', this.sessionId)]);
    if (method === 'fs/write_text_file' && typeof params.path === 'string' && /^(?:PLAN|implementation_plan)\.md$/i.test(path.basename(params.path)) && typeof params.content === 'string') this.planMarkdown = params.content;
    return result;
  }

  private closed(error: Error): void {
    this.disposed = true;
    this.cancelPermissions();
    this.transcript?.finish(this.interrupted ? 'interrupted' : 'failed', this.interrupted ? undefined : safeError(error));
    this.options.closed?.(error);
  }

  private cancelPermissions(): void {
    for (const [id, pending] of this.pending) {
      this.transcript?.event({ type: 'request.resolved', payload: { id, outcome: { kind: 'cancelled' } } });
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pending.clear();
  }
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Antigravity turn failed.'; }
