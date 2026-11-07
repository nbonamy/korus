import type { AgentRequestResponse } from '@workspace/core/agent-request';
import { sessionMcpServer } from '../acp/mcp-bridge';
import { appMcpUrlForAgent, agentScopedMcpUrl } from '../mcp/codex-config';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { normalizePromptContent, promptContentText } from '@codex-app-sdk/core/surface';
import type { Agent, BackendSession, SendPromptOptions, ConversationListInput, ConversationSummary, ConversationResumeTarget } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendEvent } from '@workspace/core/backend-driver';
import { cursorBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { CursorConversationEvent } from '@workspace/core/contracts/cursor-conversation';
import type { ExecutionObservation } from '@workspace/core/usage';
import type { BackendDriverRegistryOptions } from '../driver-rpc';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import { backendHomeDir } from '../state';
import { CursorAuthentication } from './authentication';
import { cursorRuntime, resolveCursorExecutable } from './runtime';
import { CursorSession } from './session';
import { cursorModels } from './catalog';
import { cursorAttachments } from './attachments';
import { getCursorAccountUsage } from './account-usage';

export class CursorHost implements AgentBackendDriver {
  readonly backend = 'cursor' as const;
  private readonly sessions = new Map<string, CursorSession>();
  private readonly opening = new Map<string, { abort: AbortController; done: Promise<CursorSession> }>();
  private readonly resuming = new Set<string>();
  private readonly catalogs = new Map<string, { abort: AbortController; done: Promise<ConversationSummary[]> }>();
  private readonly generations = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly usageListeners = new Set<(event: ExecutionObservation) => void>();
  private closed = false;
  private checking?: ReturnType<CursorAuthentication['authenticate']>;
  private readonly runtime;
  private readonly authentication;
  constructor(private readonly options: BackendDriverRegistryOptions = {}) {
    this.runtime = cursorRuntime(options.generalSettings?.providerHomes?.cursor);
    this.authentication = new CursorAuthentication(payload => this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload }), this.runtime);
  }
  authenticate(request: Parameters<CursorAuthentication['authenticate']>[0]) {
    if (request.action !== 'check') return this.authentication.authenticate(request);
    if (this.checking) return this.checking;
    const checking = this.authentication.authenticate(request).finally(() => { if (this.checking === checking) this.checking = undefined; });
    this.checking = checking; return checking;
  }
  getRuntimeStatus() {
    const live = [...this.sessions.values()].some(session => !session.isClosed);
    return { backend: this.backend, status: !resolveCursorExecutable() ? 'notConfigured' as const : live ? 'running' as const : this.sessions.size ? 'error' as const : 'starting' as const };
  }
  getCapabilities() { return cursorBackendCapabilities; }
  getAccountRateLimits() { return getCursorAccountUsage(this.runtime); }
  onEvent(listener: (event: BackendEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onUsage(listener: (event: ExecutionObservation) => void) { this.usageListeners.add(listener); return () => { this.usageListeners.delete(listener); }; }
  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    if (agent.backend !== this.backend || (agent.backendSession && agent.backendSession.kind !== this.backend)) throw new Error('Cursor cannot use another provider conversation.');
    if (this.resuming.has(agent.id)) throw new Error('Finish the current Cursor history operation first.');
    if (options?.planMode || options?.backendOptions) throw new Error('Cursor attachments, model and mode controls are not available yet.');
    const generation = this.generations.get(agent.id) ?? 0;
    const previous = this.queues.get(agent.id);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(agent.id, pending);
    const settle = () => { release(); if (this.queues.get(agent.id) === pending) this.queues.delete(agent.id); };
    try {
      await previous;
      if (this.closed || generation !== (this.generations.get(agent.id) ?? 0)) throw new Error('Cursor conversation was released before admission.');
      const attachments = await cursorAttachments(options?.attachments ?? []);
      const session = await this.ensure(agent);
      const model = options?.selection?.model ?? (agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.model : undefined);
      if (model) {
        if (!cursorModels(session.configuration).some(option => option.id === model)) throw new Error('Unknown Cursor model. Refresh the model catalog.');
        await session.setModel(model);
      }
      const content = options?.content === undefined ? undefined : normalizePromptContent(options.content);
      const instructions = appDeveloperInstructions(agent, this.options.pluginSettings?.(), {
        celebrationsEnabled: this.options.celebrationsEnabled?.(), developerInstructions: this.options.additionalDeveloperInstructions?.(agent),
      });
      const wire = `${promptWithSelectedReferences(prompt, content)}\n\n<context id="${randomUUID()}">\n${instructions}\n</context>`;
      const turn = session.prompt(content === undefined ? prompt : promptContentText(content), wire, content === undefined ? undefined : { promptContent: content }, attachments, (options?.attachments ?? []).map(attachment => ({ type: 'attachment', attachment: { kind: attachment.type, name: attachment.name ?? path.basename(attachment.path), path: attachment.path, ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}), ...('previewUrl' in attachment && attachment.previewUrl ? { url: attachment.previewUrl } : {}) } })));
      void turn.completion.finally(settle);
      return { backendSession: this.reference(session), turnId: turn.turnId };
    } catch (error) { settle(); throw error; }
  }
  async interrupt(agent: Agent, expectedTurnId?: string) {
    const session = this.sessions.get(agent.id);
    if (!session) throw new Error('Cursor session is not running.');
    const turnId = session.snapshot.activeTurnId ?? undefined;
    await session.interrupt(expectedTurnId);
    return { backendSession: this.reference(session), turnId };
  }
  async listConversations(agent: Agent, input?: ConversationListInput): Promise<ConversationSummary[]> {
    if (agent.backend !== this.backend || this.closed) throw new Error('Cursor history is unavailable.');
    const abort = new AbortController(), id = randomUUID();
    const done = (async () => {
      const auth = await this.authenticate({ action: 'check' });
      if (!auth.connected) throw new Error('Cursor is disconnected.');
      const cwd = this.workingDirectory(agent); await mkdir(cwd, { recursive: true, mode: 0o700 });
      const entries = await CursorSession.list({ agentId: agent.id, cwd, runtime: this.runtime, signal: abort.signal, changed: () => {}, disconnected: () => {} });
      const workspace = await realpath(cwd), query = input?.searchTerm?.trim().toLocaleLowerCase();
      const result: ConversationSummary[] = [];
      for (const entry of entries) {
        if (await realpath(entry.cwd).catch(() => null) !== workspace || (query && !`${entry.title} ${entry.sessionId}`.toLocaleLowerCase().includes(query))) continue;
        result.push({ id: entry.sessionId, sessionId: entry.sessionId, title: entry.title, updatedAt: '', messageCount: 0, storageState: 'active', ref: { backend: this.backend, folder: agent.folder, sessionId: entry.sessionId } });
      }
      return result.slice(0, Math.max(0, input?.limit ?? 100));
    })().finally(() => this.catalogs.delete(id));
    this.catalogs.set(id, { abort, done }); return done;
  }
  async resumeConversation(agent: Agent, target: ConversationResumeTarget) {
    if (agent.backend !== this.backend || target.ref.backend !== this.backend || target.ref.folder !== agent.folder || target.storageState !== 'active') throw new Error('Invalid Cursor history workspace or target.');
    if (this.closed || this.queues.has(agent.id) || this.opening.has(agent.id) || this.resuming.has(agent.id)) throw new Error('Finish the current Cursor operation first.');
    const sessionId = target.ref.sessionId;
    this.resuming.add(agent.id);
    const abort = new AbortController(), generation = this.generations.get(agent.id) ?? 0;
    const done = (async () => {
      const auth = await this.authenticate({ action: 'check' });
      if (!auth.connected) throw new Error('Cursor is disconnected.');
      const next = await CursorSession.open({ agentId: agent.id, cwd: this.workingDirectory(agent), runtime: this.runtime, mcpServers: this.mcpServers(agent), sessionId, signal: abort.signal, changed: event => this.conversationEvent(event), disconnected: error => this.disconnected(error) });
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await next.close(); throw new Error('Cursor history operation was released.'); }
      const previous = this.sessions.get(agent.id); await previous?.close();
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await next.close(); throw new Error('Cursor history operation was released.'); }
      this.sessions.set(agent.id, next); this.publishSnapshot(agent.id, next); return next;
    })().finally(() => { this.opening.delete(agent.id); this.resuming.delete(agent.id); });
    this.opening.set(agent.id, { abort, done });
    return { backendSession: this.reference(await done) };
  }
  private workingDirectory(agent: Agent): string { return agent.folder ?? path.join(backendHomeDir(), 'cursor-quick-chats', encodeURIComponent(agent.id)); }
  async listModels(agent: Agent) { return cursorModels((await this.ensure(agent)).configuration); }
  async respondToAgentRequest(response: AgentRequestResponse): Promise<void> {
    const session = response.agentId ? this.sessions.get(response.agentId) : [...this.sessions.values()].find(session => session.snapshot.clientRequests.some(request => request.id === response.id));
    if (!session) throw new Error('Cursor request is no longer pending.');
    session.respond(response);
  }
  private mcpServers(agent: Agent) {
    return [...(this.options.appMcpServerUrl ? [sessionMcpServer(appMcpUrlForAgent(this.options.appMcpServerUrl, agent))] : []), ...Object.entries(this.options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => sessionMcpServer(agentScopedMcpUrl(url, agent.id), name))];
  }
  async loadConversation(agent: Agent): Promise<BackendSession | null> {
    const current = this.sessions.get(agent.id);
    if (!current) { if (!agent.backendSession) return null; const loaded = await this.ensure(agent); return this.reference(loaded); }
    if (agent.backendSession && (agent.backendSession.kind !== this.backend || agent.backendSession.sessionId !== current.sessionId)) throw new Error('Cursor conversation identity mismatch.');
    this.publishSnapshot(agent.id, current);
    return this.reference(current);
  }
  async assertHandoffReady(agent: Agent): Promise<void> {
    if (this.queues.has(agent.id) || this.opening.has(agent.id)) throw new Error('Finish the current Cursor operation first.');
  }
  async releaseConversation(agentId: string): Promise<void> {
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
    this.opening.get(agentId)?.abort.abort();
    const session = this.sessions.get(agentId);
    await session?.close();
    if (this.sessions.get(agentId) === session) this.sessions.delete(agentId);
    await this.opening.get(agentId)?.done.catch(() => {});
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const catalog of this.catalogs.values()) catalog.abort.abort();
    for (const opening of this.opening.values()) opening.abort.abort();
    await this.authentication.close();
    await Promise.all([...this.sessions.keys()].map(id => this.releaseConversation(id)));
    await Promise.allSettled([...this.opening.values()].map(value => value.done));
    await Promise.allSettled(this.queues.values());
    await Promise.allSettled([...this.catalogs.values()].map(value => value.done));
    this.listeners.clear();
    this.usageListeners.clear();
  }
  private async ensure(agent: Agent): Promise<CursorSession> {
    const current = this.sessions.get(agent.id);
    if (current) {
      if (current.isClosed) throw new Error('Cursor connection closed. Reconnect in Settings; history resume is not available yet.');
      if (agent.backendSession && (agent.backendSession.kind !== this.backend || agent.backendSession.sessionId !== current.sessionId)) throw new Error('Cursor conversation identity mismatch.');
      if (agent.folder && path.resolve(agent.folder) !== path.resolve(current.cwd)) throw new Error('Cursor conversation belongs to another workspace.');
      return current;
    }
    if (agent.backendSession && agent.backendSession.kind !== this.backend) throw new Error('Cursor conversation identity mismatch.');
    const existing = this.opening.get(agent.id); if (existing) return existing.done;
    const generation = this.generations.get(agent.id) ?? 0;
    const abort = new AbortController();
    const done = (async () => {
      const auth = await this.authenticate({ action: 'check' });
      if (!auth.connected) throw new Error(auth.state.error ?? 'Cursor is disconnected. Sign in in Settings.');
      const cwd = this.workingDirectory(agent);
      if (!agent.folder) await mkdir(cwd, { recursive: true, mode: 0o700 });
      const session = await CursorSession.open({ agentId: agent.id, cwd, runtime: this.runtime, mcpServers: this.mcpServers(agent), sessionId: agent.backendSession?.kind === this.backend ? agent.backendSession.sessionId : undefined, signal: abort.signal,
        changed: event => this.conversationEvent(event), disconnected: error => this.disconnected(error),
      });
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await session.close(); throw new Error('Cursor session was released during startup.'); }
      this.sessions.set(agent.id, session); this.publishSnapshot(agent.id, session); return session;
    })().catch(error => { this.disconnected(error instanceof Error ? error : new Error('Cursor session failed.')); throw error; }).finally(() => this.opening.delete(agent.id));
    this.opening.set(agent.id, { abort, done }); return done;
  }
  private disconnected(error: Error): void {
    this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload: { kind: this.backend, connected: false, state: { loggedIn: false, homePath: this.runtime.homePath, error: error.message } } });
  }
  private conversationEvent(event: CursorConversationEvent): void {
    const current = this.sessions.get(event.agentId);
    if (current?.sessionId !== event.sessionId) return;
    if (this.closed) {
      if (event.type === 'turn.completed') this.observeUsage(event, event.payload.turn.status);
      return;
    }
    const identity = { backend: this.backend, agentId: event.agentId, backendSessionId: event.sessionId, conversationId: event.sessionId, turnId: event.turnId };
    // Start before transcript output reaches the daemon clock, finish after its
    // terminal events. Snapshot reads and replay never produce observations.
    if (event.type === 'turn.started') this.observeUsage(event, 'started');
    this.emit({ ...identity, type: 'cursor.conversationEventReceived', payload: { revision: this.nextRevision(event.agentId), event } });
    if (event.type === 'turn.started') this.emit({ ...identity, type: 'agent.statusChanged', payload: { type: 'working' } });
    if (event.type === 'turn.completed') this.emit({ ...identity, type: 'agent.statusChanged', payload: event.payload.turn.status === 'failed' ? { type: 'error', message: event.payload.error ?? 'Cursor turn failed.' } : { type: 'idle' } });
    if (event.type === 'turn.completed') this.observeUsage(event, event.payload.turn.status);
  }
  private observeUsage(event: CursorConversationEvent, phase: ExecutionObservation['phase']): void {
    const turn = this.sessions.get(event.agentId)?.snapshot.turns.find(turn => turn.id === event.turnId);
    const observation: ExecutionObservation = {
      provider: this.backend, agentId: event.agentId, sessionId: event.sessionId, turnId: event.turnId,
      phase, at: Date.parse(event.occurredAt), model: null, tokens: null,
      ...(phase !== 'started' && turn?.durationMs != null ? { durationMs: turn.durationMs } : {}),
    };
    for (const listener of this.usageListeners) { try { listener(observation); } catch { /* Observer isolation. */ } }
  }
  private publishSnapshot(agentId: string, session: CursorSession): void {
    this.emit({ backend: this.backend, agentId, backendSessionId: session.sessionId, conversationId: session.sessionId,
      type: 'cursor.conversationSnapshotChanged', payload: { revision: this.nextRevision(agentId), snapshot: structuredClone(session.snapshot) } });
  }
  private reference(session: CursorSession): BackendSession { return { kind: this.backend, sessionId: session.sessionId }; }
  private nextRevision(agentId: string) { const revision = (this.revisions.get(agentId) ?? 0) + 1; this.revisions.set(agentId, revision); return revision; }
  private emit(event: BackendEvent) { for (const listener of this.listeners) { try { listener(event); } catch { /* Observer isolation. */ } } }
}
