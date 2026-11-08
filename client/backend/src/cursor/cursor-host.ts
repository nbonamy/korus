import { requestFromClientRequest, type AgentRequestResponse } from '@workspace/core/agent-request';
import { sessionMcpServer } from '../acp/mcp-bridge';
import { appMcpUrlForAgent, agentScopedMcpUrl } from '../mcp/codex-config';
import { randomUUID } from 'node:crypto';
import { product } from '@workspace/core/product';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { normalizePromptContent, promptContentText } from '@codex-app-sdk/core/surface';
import type { Agent, BackendSession, SendPromptOptions, ConversationListInput, ConversationSummary, ConversationResumeTarget, BackendConversationRef, RendererMessage } from '@workspace/core/contracts';
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
import { CursorSession, isCursorAuthenticationFailure } from './session';
import { executionSelectionForAgent, resolveExecutionSelection } from '@workspace/core/execution-selection';
import { cursorAttachments } from './attachments';
import { getCursorAccountUsage } from './account-usage';

export class CursorHost implements AgentBackendDriver {
  readonly backend = 'cursor' as const;
  readonly coordinationPolicy = { authentication: { actions: ['check', 'cancel', 'logout', 'login'] as const, refreshOnAdmission: true, enableOnSuccess: false } };
  private readonly sessions = new Map<string, CursorSession>();
  private readonly opening = new Map<string, { abort: AbortController; done: Promise<CursorSession> }>();
  private readonly resuming = new Set<string>();
  private readonly readers = new Map<string, { abort: AbortController; done: Promise<RendererMessage[]> }>();
  private observedIdentity?: string;
  private authenticated = false;
  private readonly sessionIdentities = new Map<string, string | undefined>();
  private invalidating: Promise<unknown> = Promise.resolve();
  private readonly catalogs = new Map<string, { abort: AbortController; done: Promise<ConversationSummary[]> }>();
  private readonly generations = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly steering = new Set<string>();
  private readonly planModes = new Map<string, boolean>();
  private readonly nativePlanTurns = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly usageListeners = new Set<(event: ExecutionObservation) => void>();
  private closed = false;
  private checking?: ReturnType<CursorAuthentication['authenticate']>;
  private readonly runtime;
  private readonly authentication;
  constructor(private readonly options: BackendDriverRegistryOptions = {}) {
    this.runtime = cursorRuntime(options.generalSettings?.providerHomes?.cursor);
    this.authentication = new CursorAuthentication(payload => {
      const identity = JSON.stringify([payload.connected,payload.state.account?.email ?? null,payload.state.team ?? null]);
      if (this.observedIdentity !== undefined && identity !== this.observedIdentity) {
        const pending = this.invalidating;
        for (const id of new Set([...this.sessions.keys(),...this.opening.keys(),...this.queues.keys()])) this.generations.set(id,(this.generations.get(id) ?? 0)+1);
        for (const entry of this.opening.values()) entry.abort.abort();
        for (const entry of this.readers.values()) entry.abort.abort();
        for (const entry of this.catalogs.values()) entry.abort.abort();
        this.invalidating = Promise.allSettled([pending,...[...this.sessions.values()].map(session => session.close())]);
      }
      this.observedIdentity = identity; this.authenticated = payload.connected;
      this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload });
    }, this.runtime);
  }
  authenticate(request: Parameters<CursorAuthentication['authenticate']>[0]) {
    if (request.action !== 'check') return this.authentication.authenticate(request).then(async value => { await this.invalidating; return value; });
    if (this.checking) return this.checking;
    const checking = this.authentication.authenticate(request).then(async value => { await this.invalidating; return value; }).finally(() => { if (this.checking === checking) this.checking = undefined; });
    this.checking = checking; return checking;
  }
  getRuntimeStatus() {
    const live = [...this.sessions.values()].some(session => !session.isClosed);
    return { backend: this.backend, status: !resolveCursorExecutable() ? 'notConfigured' as const : live ? 'running' as const : this.sessions.size ? 'error' as const : 'starting' as const, capabilities: this.getCapabilities() };
  }
  getCapabilities() { return { ...cursorBackendCapabilities, steerPrompt: this.options.cursorSteeringFallbackEnabled?.() === true }; }
  getAccountRateLimits() { return getCursorAccountUsage(this.runtime); }
  onEvent(listener: (event: BackendEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onUsage(listener: (event: ExecutionObservation) => void) { this.usageListeners.add(listener); return () => { this.usageListeners.delete(listener); }; }
  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions, admissionGuard?: () => void) {
    const agentId = agent.id;
    if (agent.backend !== this.backend || (agent.backendSession && agent.backendSession.kind !== this.backend)) throw new Error('Cursor cannot use another provider conversation.');
    if (this.steering.has(agent.id) && !admissionGuard) throw new Error('Finish the current Cursor steering operation first.');
    if (this.resuming.has(agent.id)) throw new Error('Finish the current Cursor history operation first.');
    if (options?.backendOptions) throw new Error('Cursor backend options are not available.');
    const selection=resolveExecutionSelection(executionSelectionForAgent(agent),options?.selection);
    if (selection.serviceTier!==null) throw new Error('Cursor service tiers are not supported.');
    const generation = this.generations.get(agentId) ?? 0;
    const previous = this.queues.get(agentId);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.queues.set(agentId, pending);
    const settle = () => { release(); if (this.queues.get(agentId) === pending) this.queues.delete(agentId); };
    try {
      await previous;
      if (this.closed || generation !== (this.generations.get(agentId) ?? 0)) throw new Error('Cursor conversation was released before admission.');
      admissionGuard?.();
      const attachments = await cursorAttachments(options?.attachments ?? []);
      admissionGuard?.();
      const session = await this.ensure(agent);
      admissionGuard?.();
      const model=selection.model;
      if (model) {
        if (!session.models.some(option => option.id === model)) throw new Error('Unknown Cursor model. Refresh the model catalog.');
        await session.setModel(model);
        admissionGuard?.();
      }
      if (selection.reasoningEffort!==null) await session.setReasoningEffort(selection.reasoningEffort);
      admissionGuard?.();
      await session.setPromptMode(options?.planMode === true);
      admissionGuard?.();
      session.assertSelection(selection.model,selection.reasoningEffort,options?.planMode === true);
      const content = options?.content === undefined ? undefined : normalizePromptContent(options.content);
      const instructions = appDeveloperInstructions(agent, this.options.pluginSettings?.(), {
        celebrationsEnabled: this.options.celebrationsEnabled?.(), developerInstructions: this.options.additionalDeveloperInstructions?.(agent),
      });
      const wire = `${promptWithSelectedReferences(prompt, content)}\n\n<context id="${randomUUID()}">\n${instructions}\n</context>`;
      this.planModes.set(agent.id, options?.planMode === true);
      const turn = session.prompt(content === undefined ? prompt : promptContentText(content), wire, content === undefined ? undefined : { promptContent: content }, attachments, (options?.attachments ?? []).map(attachment => ({ type: 'attachment', attachment: { kind: attachment.type, name: attachment.name ?? path.basename(attachment.path), path: attachment.path, ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}), ...('previewUrl' in attachment && attachment.previewUrl ? { url: attachment.previewUrl } : {}) } })));
      void turn.completion.finally(settle);
      return { backendSession: this.reference(session), turnId: turn.turnId };
    } catch (error) { settle(); throw error; }
  }
  async steerPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    const agentId = agent.id;
    if (!this.getCapabilities().steerPrompt) throw new Error('Cursor prompt steering fallback is disabled.');
    if (this.steering.has(agent.id)) throw new Error('Finish the current Cursor steering operation first.');
    const session = this.sessions.get(agent.id);
    if (agent.backend !== this.backend || agent.backendSession?.kind !== this.backend || !session || session.isClosed || session.sessionId !== agent.backendSession.sessionId) throw new Error('Cursor steering requires the saved running session.');
    if (path.resolve(this.workingDirectory(agent)) !== path.resolve(session.cwd)) throw new Error('Cursor steering workspace mismatch.');
    const turnId = session.snapshot.activeTurnId;
    if (!turnId) throw new Error('Cursor steering requires a running turn.');
    const generation = this.generations.get(agentId) ?? 0, identity = this.observedIdentity, folder = agent.folder;
    const assertIdentity = () => {
      if (!this.getCapabilities().steerPrompt) throw new Error('Cursor prompt steering fallback is disabled.');
      if (this.closed || session.isClosed || this.sessions.get(agentId) !== session || generation !== (this.generations.get(agentId) ?? 0) || identity !== this.observedIdentity) throw new Error('Cursor steering session was released or its identity changed.');
      if (agent.id !== agentId || agent.backend !== this.backend || agent.backendSession?.kind !== this.backend || agent.backendSession.sessionId !== session.sessionId || agent.folder !== folder || path.resolve(this.workingDirectory(agent)) !== path.resolve(session.cwd)) throw new Error('Cursor steering conversation identity or workspace changed.');
      if (session.snapshot.activeTurnId || session.snapshot.turns.at(-1)?.id !== turnId) throw new Error('Cursor turn changed during steering.');
    };
    this.steering.add(agentId);
    try {
      // ACP cancellation settles callbacks and fences late frames before a distinct prompt is admitted.
      await session.interrupt(turnId);
      assertIdentity();
      if (this.queues.has(agentId)) throw new Error('Finish the current Cursor operation before steering.');
      return await this.sendPrompt(agent, prompt, options, assertIdentity);
    } finally { this.steering.delete(agentId); }
  }
  async continueInterruptedTurn(agent: Agent): Promise<import('@workspace/core/backend-driver').BackendTurnActionResult> {
    if (agent.backendSession?.kind !== this.backend) throw new Error('No Cursor session to continue.');
    const result = await this.sendPrompt(agent,'continue');
    return {backendSession:result.backendSession,activeTurnId:result.turnId};
  }
  async interrupt(agent: Agent, expectedTurnId?: string) {
    const session = this.sessions.get(agent.id);
    if (!session) throw new Error('Cursor session is not running.');
    const turnId = session.snapshot.activeTurnId ?? undefined;
    await session.interrupt(expectedTurnId);
    return { backendSession: this.reference(session), turnId };
  }
  async readConversationMessages(ref: BackendConversationRef, agentId: string): Promise<RendererMessage[]> {
    if (ref.backend !== this.backend || this.closed) throw new Error('Invalid Cursor conversation reference.');
    const current = this.sessions.get(agentId);
    const cwd = ref.folder ?? path.join(backendHomeDir(), 'cursor-quick-chats', encodeURIComponent(agentId));
    if (current?.sessionId === ref.sessionId) {
      if (await realpath(cwd) !== await realpath(current.cwd)) throw new Error('Cursor conversation belongs to another workspace.');
      return structuredClone(current.snapshot.messages);
    }
    const sessionId = ref.sessionId, abort = new AbortController(), id = randomUUID();
    const done = (async () => {
      const auth = await this.authenticate({action:'check'});
      if (!auth.connected) throw new Error('Cursor is disconnected.');
      const session = await CursorSession.open({agentId,cwd,runtime:this.runtime,sessionId,signal:abort.signal,changed:()=>{},disconnected:()=>{}});
      try {
        if (this.closed || abort.signal.aborted) throw new Error('Cursor history read was released.');
        return structuredClone(session.snapshot.messages);
      } finally { await session.close(); }
    })().finally(() => this.readers.delete(id));
    this.readers.set(id,{abort,done}); return done;
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
      const next = await CursorSession.open({ permissionMode: this.permissionMode(agent), agentId: agent.id, cwd: this.workingDirectory(agent), runtime: this.runtime, mcpServers: this.mcpServers(agent), appMcpServerName: this.options.appMcpServerUrl ? product.mcpServerName : undefined, sessionId, signal: abort.signal, changed: event => this.conversationEvent(event), disconnected: error => this.disconnected(error) });
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await next.close(); throw new Error('Cursor history operation was released.'); }
      const previous = this.sessions.get(agent.id); await previous?.close();
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await next.close(); throw new Error('Cursor history operation was released.'); }
      this.sessionIdentities.set(agent.id,this.observedIdentity); this.sessions.set(agent.id, next); this.publishSnapshot(agent.id, next); return next;
    })().finally(() => { this.opening.delete(agent.id); this.resuming.delete(agent.id); });
    this.opening.set(agent.id, { abort, done });
    return { backendSession: this.reference(await done) };
  }
  private workingDirectory(agent: Agent): string { return agent.folder ?? path.join(backendHomeDir(), 'cursor-quick-chats', encodeURIComponent(agent.id)); }
  private permissionMode(agent: Agent): 'default' | 'full-access' {
    const mode = agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.permissionMode ?? 'default' : 'default';
    if (mode !== 'default' && mode !== 'full-access') throw new Error('Unsupported permission mode for Cursor.');
    return mode;
  }
  async setPermissionMode(agent: Agent, mode: string) {
    if (this.closed || agent.backend !== this.backend || (agent.backendSession && agent.backendSession.kind !== this.backend)) throw new Error('Cursor conversation identity mismatch.');
    const defaults = { ...(agent.backendDefaults?.kind === this.backend ? agent.backendDefaults : {}), kind: this.backend, permissionMode: mode };
    const permission = this.permissionMode({ ...agent, backendDefaults: defaults });
    await this.opening.get(agent.id)?.done;
    const session = this.sessions.get(agent.id);
    if (session && agent.backendSession?.kind === this.backend && agent.backendSession.sessionId !== session.sessionId) throw new Error('Cursor conversation identity mismatch.');
    if (session && agent.folder && path.resolve(agent.folder) !== path.resolve(session.cwd)) throw new Error('Cursor conversation belongs to another workspace.');
    if (session && !session.isClosed) session.setPermissionMode(permission);
    return { backendDefaults: defaults };
  }
  async listModels(agent: Agent) { return (await this.ensure(agent)).models; }
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
    if (this.queues.has(agent.id) || this.opening.has(agent.id) || this.steering.has(agent.id)) throw new Error('Finish the current Cursor operation first.');
  }
  async releaseConversation(agentId: string): Promise<void> {
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
    this.opening.get(agentId)?.abort.abort();
    const session = this.sessions.get(agentId);
    await session?.close();
    if (this.sessions.get(agentId) === session) this.sessions.delete(agentId);
    await this.opening.get(agentId)?.done.catch(() => {});
    this.planModes.delete(agentId);
    for (const key of this.nativePlanTurns) if (JSON.parse(key)[0] === agentId) this.nativePlanTurns.delete(key);
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const reader of this.readers.values()) reader.abort.abort();
    for (const catalog of this.catalogs.values()) catalog.abort.abort();
    for (const opening of this.opening.values()) opening.abort.abort();
    await this.authentication.close();
    await Promise.all([...this.sessions.keys()].map(id => this.releaseConversation(id)));
    await Promise.allSettled([...this.opening.values()].map(value => value.done));
    await Promise.allSettled(this.queues.values());
    await Promise.allSettled([...this.catalogs.values()].map(value => value.done));
    await Promise.allSettled([...this.readers.values()].map(value => value.done));
    await this.invalidating;
    this.planModes.clear();
    this.nativePlanTurns.clear();
    this.listeners.clear();
    this.usageListeners.clear();
  }
  private async ensure(agent: Agent): Promise<CursorSession> {
    const current = this.sessions.get(agent.id);
    if (current) {
      if (current.isClosed) {
        if (!agent.backendSession) throw new Error('Cursor connection closed. A saved session reference is required.');
        if (!this.authenticated) throw new Error('Cursor is disconnected. Sign in in Settings.');
        if (this.sessionIdentities.get(agent.id) !== this.observedIdentity) throw new Error('Cursor account identity changed. Explicitly select a conversation from history.');
      }
      if (agent.backendSession && (agent.backendSession.kind !== this.backend || agent.backendSession.sessionId !== current.sessionId)) throw new Error('Cursor conversation identity mismatch.');
      if (agent.folder && path.resolve(agent.folder) !== path.resolve(current.cwd)) throw new Error('Cursor conversation belongs to another workspace.');
      if (!current.isClosed) return current;
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
      const session = await CursorSession.open({ agentId: agent.id, cwd, permissionMode: this.permissionMode(agent), runtime: this.runtime, mcpServers: this.mcpServers(agent), appMcpServerName: this.options.appMcpServerUrl ? product.mcpServerName : undefined, sessionId: agent.backendSession?.kind === this.backend ? agent.backendSession.sessionId : undefined, signal: abort.signal,
        changed: event => this.conversationEvent(event), disconnected: error => this.disconnected(error),
      });
      if (this.closed || abort.signal.aborted || generation !== (this.generations.get(agent.id) ?? 0)) { await session.close(); throw new Error('Cursor session was released during startup.'); }
      this.sessionIdentities.set(agent.id,this.observedIdentity); this.sessions.set(agent.id, session); this.publishSnapshot(agent.id, session); return session;
    })().catch(error => { this.disconnected(error instanceof Error ? error : new Error('Cursor session failed.')); throw error; }).finally(() => this.opening.delete(agent.id));
    this.opening.set(agent.id, { abort, done }); return done;
  }
  private disconnected(error: Error): void {
    if (isCursorAuthenticationFailure(error)) this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload: { kind: this.backend, connected: false, state: { loggedIn: false, homePath: this.runtime.homePath, error: error.message } } });
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
    if (event.type === 'request.created') this.emit({ ...identity, type: 'agentRequest.created', payload: { request: requestFromClientRequest(event.payload.request, { conversationId: event.sessionId, turnId: event.turnId }) } });
    else if (event.type === 'request.resolved') this.emit({ ...identity, type: 'agentRequest.resolved', payload: event.payload });
    if (event.type === 'request.created' && event.payload.request.kind === 'confirm_tool' && event.payload.request.payload.confirmation.toolName === 'create_plan') {
      const request = event.payload.request;
      this.nativePlanTurns.add(JSON.stringify([event.agentId, event.turnId]));
      this.emit({ ...identity, type: 'plan.readyForReview', payload: {
        markdown: request.payload.confirmation.argumentsPreview, itemId: request.id, requestId: request.id,
      } });
    }
    if (event.type === 'turn.completed') {
      const native = this.nativePlanTurns.delete(JSON.stringify([event.agentId, event.turnId]));
      const planning = this.planModes.get(event.agentId);
      this.planModes.delete(event.agentId);
      if (planning && !native && event.payload.turn.status === 'completed') {
        const markdown = current.snapshot.messages
          .filter(message => message.turnId === event.turnId && message.role === 'assistant')
          .flatMap(message => message.parts).filter(part => part.type === 'text')
          .map(part => part.text).join('\n\n').trim();
        if (markdown) this.emit({ ...identity, type: 'plan.readyForReview', payload: { markdown, itemId: `cursor-plan:${event.turnId}` } });
      }
    }
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
