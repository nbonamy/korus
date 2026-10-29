import { normalizePromptContent, promptContentText } from '@codex-app-sdk/core/surface';
import { promptWithSelectedReferences } from '../agents/prompt-content';
import type { ExecutionObservation } from '@workspace/core/usage';
import { mkdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Agent, BackendConversationRef, BackendModelOption, BackendRuntimeStatus, BackendSession, ConversationListInput, ConversationSummary, ConversationResumeTarget, SendPromptOptions } from '@workspace/core/contracts';
import type { AgentBackendDriver, BackendEvent, BackendCodeReviewInput, BackendCodeReviewResult, BackendTextGenerationInput } from '@workspace/core/backend-driver';
import { requestFromClientRequest, type AgentRequestResponse } from '@workspace/core/agent-request';
import type { ProviderAuthentication, ProviderAuthenticationAction } from '@workspace/core/contracts/provider-setup';
import type { AntigravityConversationEvent } from '@workspace/core/contracts/antigravity-conversation';
import { antigravityBackendCapabilities } from '@workspace/core/backend-capabilities';
import type { BackendDriverRegistryOptions } from '../driver-rpc';
import { backendHomeDir } from '../state';
import { appMcpUrlForAgent, agentScopedMcpUrl } from '../mcp/codex-config';
import { appDeveloperInstructions } from '../mcp/agent-prompts';
import { AcpRuntime, NativeLoginRequired } from './acp-runtime';
import { AcpSession } from './session';
import { antigravityHome, resolveAcpRuntime } from './runtime';
import { record } from './acp-connection';
import { sessionMcpServer } from './mcp-bridge';
import { listAcpSessions } from './catalog';
import { acpAttachments } from './attachments';
import { AcpPromptJournal } from './prompt-journal';

export class AntigravityHost implements AgentBackendDriver {
  readonly backend = 'antigravity' as const;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly opening = new Map<string, Promise<AcpSession>>();
  private readonly generations = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private readonly reviewScopes = new Map<string, string>();
  private readonly resuming = new Map<string, Promise<void>>();
  private readonly auxiliary = new Set<AcpSession>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly usageListeners = new Set<(event: ExecutionObservation) => void>();
  onUsage(listener: (event: ExecutionObservation) => void) { this.usageListeners.add(listener); return () => { this.usageListeners.delete(listener); }; }
  private observeUsage(event: ExecutionObservation) { for (const listener of this.usageListeners) { try { listener(event); } catch { /* Observer isolation. */ } } }
  private authentication?: AcpRuntime;
  private auth?: { action: ProviderAuthenticationAction['action']; abort: AbortController; done: Promise<ProviderAuthentication> };
  private closed = false;
  constructor(private readonly options: BackendDriverRegistryOptions = {}) {}

  getRuntimeStatus(): BackendRuntimeStatus {
    return { backend: this.backend, status: !resolveAcpRuntime() ? 'notConfigured' : this.sessions.size ? 'running' : 'starting' };
  }
  getCapabilities() { return antigravityBackendCapabilities; }
  onEvent(listener: (event: BackendEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  async authenticate(request: ProviderAuthenticationAction): Promise<ProviderAuthentication> {
    if (request.action === 'cancel') {
      this.auth?.abort.abort();
      await this.authentication?.close();
      return this.authState(false);
    }
    if (this.closed) throw new Error('Antigravity host is closed.');
    const previous = this.auth;
    // A background check must never make the user's explicit sign-in fail; the login supersedes it.
    if (previous && !(previous.action === 'check' && request.action === 'login')) throw new Error('Antigravity authentication is already in progress.');
    const abort = new AbortController();
    const entry: NonNullable<typeof this.auth> = { action: request.action, abort, done: Promise.resolve(null as never) };
    entry.done = (async () => {
      if (previous) { previous.abort.abort(); await this.authentication?.close(); await previous.done.catch(() => {}); }
      return this.runAuthentication(request, abort, entry);
    })();
    this.auth = entry;
    return entry.done;
  }

  private async runAuthentication(request: ProviderAuthenticationAction, abort: AbortController, entry: NonNullable<typeof this.auth>): Promise<ProviderAuthentication> {
    try {
      if (abort.signal.aborted || this.closed) throw new Error('Antigravity authentication cancelled.');
      const home = antigravityHome();
      await mkdir(home, { recursive: true, mode: 0o700 });
      this.authentication = await AcpRuntime.open({ cwd: home, home, interactive: request.action === 'login', signal: abort.signal,
        onRequest: async () => { throw new Error('No session during authentication.'); }, onNotification: () => {}, onClose: () => {},
      });
      if (abort.signal.aborted) throw new Error('Antigravity authentication cancelled.');
      if (request.action === 'logout') {
        await Promise.all([...this.sessions.keys()].map(id => this.releaseConversation(id)));
        await this.authentication.connection.request('logout', {});
        return this.authState(false);
      }
      try {
        await this.authentication.authenticate();
        if (abort.signal.aborted) throw new Error('Antigravity authentication cancelled.');
        return this.authState(true);
      }
      catch (error) { if (error instanceof NativeLoginRequired) return this.authState(false); throw error; }
    } finally {
      await this.authentication?.close(); this.authentication = undefined;
      if (this.auth === entry) this.auth = undefined;
    }
  }

  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    const content = options?.content === undefined ? undefined : normalizePromptContent(options.content);
    const attachments = await acpAttachments(options?.attachments ?? []);
    const session = await this.ensure(agent);
    const model = options?.selection?.model ?? (agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.model : undefined);
    if (model) await session.setModel(model);
    const permission = options?.backendOptions?.kind === this.backend ? options.backendOptions.permissionMode
      : agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.permissionMode : undefined;
    if (permission) await session.setMode(permission);
    const instructions = appDeveloperInstructions(agent, this.options.pluginSettings?.(), {
      celebrationsEnabled: this.options.celebrationsEnabled?.(), developerInstructions: this.options.additionalDeveloperInstructions?.(agent),
    });
    const planning = options?.planMode === true || /^\/plan(?:\s|$)/.test(prompt);
    const wireText = `${planning && !prompt.startsWith('/plan') ? '/plan ' : ''}${promptWithSelectedReferences(prompt, content)}\n\n<context id="${randomUUID()}">\n${instructions}${planning ? '\nWrite the plan and stop. Do not implement it or request implementation approval in this turn; Korus will collect the decision after showing the plan.' : ''}\n</context>`;
    const { turnId, completion } = session.prompt(content === undefined ? prompt : promptContentText(content), [{ type: 'text', text: wireText }, ...attachments],
      (options?.attachments ?? []).map(attachment => ({ type: 'attachment', attachment: {
        kind: attachment.type, name: attachment.name ?? path.basename(attachment.path), path: attachment.path, mimeType: attachment.mimeType,
      } })), content === undefined ? undefined : { promptContent: content });
    if (planning) void completion.then(() => {
      if (this.sessions.get(agent.id) !== session || session.snapshot.turns.find(turn => turn.id === turnId)?.status !== 'completed') return;
      const markdown = session.writtenPlan ?? session.snapshot.messages.filter(message => message.turnId === turnId && message.role === 'assistant')
        .flatMap(message => message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])).join('\n');
      if (markdown.trim()) this.emit({ type: 'plan.readyForReview', backend: this.backend, agentId: agent.id, conversationId: session.sessionId, turnId, payload: { markdown } });
    });
    return { backendSession: this.reference(session), turnId };
  }

  async continueInterruptedTurn(agent: Agent): Promise<import('@workspace/core/backend-driver').BackendTurnActionResult> {
    if (agent.backendSession?.kind !== 'antigravity') throw new Error('No Antigravity session to continue.');
    const result = await this.sendPrompt(agent, 'continue');
    return { backendSession: result.backendSession, activeTurnId: result.turnId };
  }

  async interrupt(agent: Agent, expectedTurnId?: string) {
    const session = this.sessions.get(agent.id);
    if (!session) throw new Error('Antigravity session is not running.');
    const turnId = session.snapshot.activeTurnId ?? undefined;
    await session.interrupt(expectedTurnId);
    return { backendSession: this.reference(session), turnId };
  }

  async runCodeReview(agent: Agent, input: BackendCodeReviewInput): Promise<BackendCodeReviewResult> {
    if (input.reviewerSession && input.reviewerSession.kind !== this.backend) throw new Error('Antigravity cannot continue another provider review.');
    const reviewer = { ...agent, folder: input.cwd, backendSession: input.reviewerSession };
    const session = await this.ensure(reviewer, input.reviewMcpServerUrl);
    const model = agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.model : undefined;
    if (model) await session.setModel(model);
    const turn = session.prompt(input.prompt);
    await turn.completion;
    if (session.snapshot.turns.find(candidate => candidate.id === turn.turnId)?.status !== 'completed') throw new Error(session.snapshot.error ?? 'Antigravity review was interrupted.');
    const text = session.snapshot.messages.filter(message => message.turnId === turn.turnId && message.role === 'assistant')
      .flatMap(message => message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])).join('\n');
    return { text, reviewerSession: this.reference(session) };
  }

  async generateText(agent: Agent, input: BackendTextGenerationInput): Promise<{ text: string }> {
    if (this.closed) throw new Error('Antigravity host is closed.');
    const session = await this.openSession({ agentId: `generation-${randomUUID()}`, cwd: input.cwd, mcpServers: [], tools: false, ephemeral: true, changed: () => {}, usage: event => this.observeUsage({ ...event, agentId: agent.id }) });
    this.auxiliary.add(session);
    try {
      if (this.closed) throw new Error('Antigravity host is closed.');
      const model = agent.backendDefaults?.kind === this.backend ? agent.backendDefaults.model : undefined;
      if (model) await session.setModel(model);
      await session.setMode('default');
      const turn = session.prompt([input.developerInstructions, 'Return only the requested text. Do not call tools.',
        input.outputSchema ? `Return JSON matching this schema: ${JSON.stringify(input.outputSchema)}` : '', input.prompt].filter(Boolean).join('\n\n'));
      await turn.completion;
      if (session.snapshot.turns[0]?.status !== 'completed') throw new Error(session.snapshot.error ?? 'Antigravity text generation failed.');
      const text = session.snapshot.messages.filter(message => message.role === 'assistant')
        .flatMap(message => message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])).join('\n');
      if (!text.trim()) throw new Error('Antigravity returned no text.');
      return { text };
    } finally { this.auxiliary.delete(session); await session.close(); }
  }

  async disposeCodeReview(agent: Agent, reviewerSession: BackendSession): Promise<void> {
    if (reviewerSession.kind !== this.backend) throw new Error('Antigravity cannot dispose another provider review.');
    const session = this.sessions.get(agent.id);
    if (session && session.sessionId !== reviewerSession.sessionId) throw new Error('Antigravity review session changed.');
    await this.releaseConversation(agent.id);
  }

  async respondToAgentRequest(response: AgentRequestResponse): Promise<void> {
    const session = response.agentId ? this.sessions.get(response.agentId)
      : [...this.sessions.values()].find(candidate => candidate.snapshot.clientRequests.some(request => request.id === response.id));
    if (!session) throw new Error('Antigravity request is no longer pending.');
    session.respond(response);
  }

  async loadConversation(agent: Agent): Promise<BackendSession | null> {
    if (!agent.backendSession && !this.sessions.has(agent.id)) return null;
    const session = await this.ensure(agent);
    this.publishSnapshot(agent.id, session);
    return this.reference(session);
  }

  async resumeConversation(agent: Agent, target: ConversationResumeTarget) {
    if (target.ref.backend !== this.backend || target.storageState !== 'active') throw new Error('Invalid Antigravity conversation target.');
    if (target.ref.folder !== agent.folder) throw new Error('Antigravity conversation belongs to another workspace.');
    const existing = this.sessions.get(agent.id);
    if (existing?.snapshot.busy || this.opening.has(agent.id) || this.resuming.has(agent.id)) throw new Error('Finish the current Antigravity operation before resuming history.');
    // Open and validate complete replay before replacing the visible conversation.
    const generation = this.generations.get(agent.id) ?? 0;
    let finishResume!: () => void;
    this.resuming.set(agent.id, new Promise<void>(resolve => { finishResume = resolve; }));
    try {
      const next = await this.open(agent, target.ref.sessionId);
      if (this.closed || generation !== (this.generations.get(agent.id) ?? 0)) { await next.close(); throw new Error('Antigravity session was released during history loading.'); }
      await this.releaseConversation(agent.id);
      this.sessions.set(agent.id, next);
      this.publishSnapshot(agent.id, next);
      return { backendSession: this.reference(next) };
    } finally { this.resuming.delete(agent.id); finishResume(); }
  }

  async listConversations(agent: Agent, input?: ConversationListInput): Promise<ConversationSummary[]> {
    await mkdir(this.workingDirectory(agent), { recursive: true });
    const runtime = await AcpRuntime.open({ cwd: this.workingDirectory(agent),
      onRequest: async () => { throw new Error('No active Antigravity conversation.'); }, onNotification: () => {}, onClose: () => {},
    });
    try {
      await runtime.authenticate();
      const query = input?.searchTerm?.trim().toLocaleLowerCase();
      const cwd = await realpath(this.workingDirectory(agent));
      const home = antigravityHome();
      const entries = await Promise.all((await listAcpSessions(runtime.connection)).map(async entry => ({ ...entry, cwd: await realpath(entry.cwd).catch(() => null),
        ephemeral: await AcpPromptJournal.isEphemeral(home, entry.sessionId) })));
      return entries
        .filter(entry => !entry.ephemeral)
        .filter(entry => entry.cwd === cwd)
        .filter(entry => !query || `${entry.title} ${entry.sessionId}`.toLocaleLowerCase().includes(query))
        .slice(0, input?.limit ?? 100)
        .map(entry => ({ id: entry.sessionId, sessionId: entry.sessionId, title: entry.title,
          updatedAt: '', messageCount: 0, storageState: 'active',
          ref: { backend: this.backend, folder: agent.folder, sessionId: entry.sessionId } }));
    } catch (error) { if (error instanceof NativeLoginRequired) this.authState(false); throw error; }
    finally { await runtime.close(); }
  }

  async readConversationMessages(ref: BackendConversationRef, agentId: string) {
    if (ref.backend !== this.backend) throw new Error('Antigravity cannot read another provider conversation.');
    const current = this.sessions.get(agentId);
    if (current?.sessionId === ref.sessionId) {
      if (await realpath(current.cwd) !== await realpath(this.workingDirectory({ id: agentId, folder: ref.folder }))) throw new Error('Antigravity conversation belongs to another workspace.');
      return structuredClone(current.snapshot.messages);
    }
    const session = await this.openSession({ agentId, cwd: this.workingDirectory({ id: agentId, folder: ref.folder }), sessionId: ref.sessionId, mcpServers: [], changed: () => {} });
    try { return structuredClone(session.snapshot.messages); } finally { await session.close(); }
  }

  async readConversationSummary(agent: Agent, ref: BackendConversationRef): Promise<ConversationSummary | null> {
    if (ref.backend !== this.backend || ref.folder !== agent.folder) return null;
    return (await this.listConversations(agent)).find(entry => entry.sessionId === ref.sessionId) ?? null;
  }

  async listModels(agent: Agent): Promise<BackendModelOption[]> {
    const resuming = this.resuming.get(agent.id);
    if (resuming) await resuming;
    // Read the adopted session; a cancelled resume must not reopen the caller's old reference.
    const session = resuming ? this.sessions.get(agent.id) : await this.ensure(agent);
    if (!session || session.isClosed) throw new Error('Antigravity session was released during model loading.');
    const models = session.configuration.models;
    if (!record(models) || !Array.isArray(models.availableModels)) return [];
    return models.availableModels.filter(record).filter(model => typeof model.modelId === 'string').map(model => ({
      id: model.modelId as string, model: model.modelId as string,
      displayName: typeof model.name === 'string' ? model.name : model.modelId as string,
      ...(typeof model.description === 'string' ? { description: model.description } : {}),
      isDefault: model.modelId === models.currentModelId,
    }));
  }

  async setPermissionMode(agent: Agent, mode: string) {
    await (await this.ensure(agent)).setMode(mode);
    return { backendDefaults: { ...(agent.backendDefaults?.kind === this.backend ? agent.backendDefaults : {}), kind: this.backend, permissionMode: mode } };
  }

  async releaseConversation(agentId: string): Promise<void> {
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
    const session = this.sessions.get(agentId); this.sessions.delete(agentId);
    this.reviewScopes.delete(agentId);
    await session?.close();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.auth?.abort.abort();
    await this.authentication?.close();
    await Promise.all([...this.auxiliary].map(session => session.close()));
    await Promise.all([...this.sessions.keys()].map(id => this.releaseConversation(id)));
    await Promise.allSettled(this.opening.values());
  }

  private async ensure(agent: Agent, reviewUrl?: string): Promise<AcpSession> {
    if (this.closed) throw new Error('Antigravity host is closed.');
    if (this.resuming.has(agent.id)) throw new Error('Antigravity history is still loading.');
    if (this.reviewScopes.get(agent.id) !== reviewUrl) {
      if (this.sessions.get(agent.id)?.snapshot.busy || this.opening.has(agent.id)) throw new Error('Antigravity collaboration scope cannot change during a turn.');
      await this.releaseConversation(agent.id);
    }
    const current = this.sessions.get(agent.id);
    if (current && !current.isClosed) return current;
    const pending = this.opening.get(agent.id);
    if (pending) return pending;
    const generation = this.generations.get(agent.id) ?? 0;
    const sessionId = agent.backendSession?.kind === this.backend ? agent.backendSession.sessionId : current?.sessionId;
    if (reviewUrl) this.reviewScopes.set(agent.id, reviewUrl);
    const work = this.open(agent, sessionId, reviewUrl).then(async session => {
      if (this.closed || generation !== (this.generations.get(agent.id) ?? 0)) { await session.close(); throw new Error('Antigravity session was released during startup.'); }
      this.sessions.set(agent.id, session);
      this.publishSnapshot(agent.id, session);
      return session;
    }).finally(() => this.opening.delete(agent.id));
    this.opening.set(agent.id, work);
    return work;
  }

  private async open(agent: Agent, sessionId?: string, reviewUrl?: string): Promise<AcpSession> {
    const cwd = this.workingDirectory(agent);
    if (!agent.folder) await mkdir(cwd, { recursive: true, mode: 0o700 });
    const mcpServers = reviewUrl ? [sessionMcpServer(reviewUrl, undefined, ['report_finding', 'update_finding', 'delete_finding', 'finish_review_round', 'set-status', 'finish_turn'])] : [
      ...(this.options.appMcpServerUrl ? [sessionMcpServer(appMcpUrlForAgent(this.options.appMcpServerUrl, agent))] : []),
      ...Object.entries(this.options.hostedMcpServerUrls?.() ?? {}).map(([name, url]) => sessionMcpServer(agentScopedMcpUrl(url, agent.id), name)),
    ];
    return this.openSession({ agentId: agent.id, cwd, sessionId, mcpServers, ephemeral: Boolean(reviewUrl), changed: event => this.conversationEvent(event), usage: event => this.observeUsage(event) });
  }

  private async openSession(options: Parameters<typeof AcpSession.open>[0]): Promise<AcpSession> {
    try { return await AcpSession.open(options); }
    catch (error) { if (error instanceof NativeLoginRequired) this.authState(false); throw error; }
  }

  private workingDirectory(agent: Pick<Agent, 'folder' | 'id'>): string {
    return agent.folder ?? path.join(backendHomeDir(), 'antigravity-quick-chats', encodeURIComponent(agent.id));
  }

  private conversationEvent(event: AntigravityConversationEvent): void {
    const identity = { agentId: event.agentId, backend: this.backend, backendSessionId: event.sessionId, conversationId: event.sessionId, turnId: event.turnId };
    this.emit({ ...identity, type: 'antigravity.conversationEventReceived', payload: { revision: this.nextRevision(event.agentId), event } });
    if (event.type === 'request.created') this.emit({ ...identity, type: 'agentRequest.created', payload: { request: requestFromClientRequest(event.payload.request, { conversationId: event.sessionId, turnId: event.turnId }) } });
    else if (event.type === 'request.resolved') this.emit({ ...identity, type: 'agentRequest.resolved', payload: event.payload });
    else if (event.type === 'turn.started') this.emit({ ...identity, type: 'agent.statusChanged', payload: { type: 'working' } });
    else if (event.type === 'turn.completed') this.emit({ ...identity, type: 'agent.statusChanged', payload: event.payload.turn.status === 'failed' ? { type: 'error', message: event.payload.error ?? 'Antigravity turn failed.' } : { type: 'idle' } });
  }
  private publishSnapshot(agentId: string, session: AcpSession): void {
    this.emit({ type: 'antigravity.conversationSnapshotChanged', agentId, backend: this.backend, backendSessionId: session.sessionId, conversationId: session.sessionId,
      payload: { revision: this.nextRevision(agentId), snapshot: session.snapshot } });
  }
  private reference(session: AcpSession): BackendSession { return { kind: this.backend, sessionId: session.sessionId }; }
  private nextRevision(agentId: string): number { const revision = (this.revisions.get(agentId) ?? 0) + 1; this.revisions.set(agentId, revision); return revision; }
  private authState(connected: boolean): ProviderAuthentication {
    const state: ProviderAuthentication = { kind: this.backend, connected, state: { loggedIn: connected, homePath: antigravityHome() } };
    this.emit({ type: 'provider.authenticationChanged', backend: this.backend, payload: state }); return state;
  }
  private emit(event: BackendEvent): void { for (const listener of this.listeners) listener(event); }
}
