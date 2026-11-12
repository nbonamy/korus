import { randomUUID } from 'node:crypto';
import { runtimeStatusDetail, withStatusWording } from './provider-status-wording';
import type { Harness, HarnessDefaults, HarnessEvent, Session, SessionData, SessionPatch } from '@korus-dev/multi-agent-sdk';
import type { Agent, HarnessProvider, ProviderConversationRef, ProviderDefaults, ProviderSessionData, SendPromptOptions } from '@workspace/core/contracts';
import type { AgentProviderDriver, BackendEvent, ProviderCodeReviewInput, ProviderCodeReviewResult, ProviderCoordinationPolicy } from '@workspace/core/provider-driver';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { providerDisplayName, unsupportedProviderFeature } from '@workspace/core/provider-driver';
import { HarnessUnsupportedError } from '@korus-dev/multi-agent-sdk';
import { sessionConversationId } from '@korus-dev/multi-agent-sdk/contracts';

type ProviderRuntimeStatus = ReturnType<AgentProviderDriver['getRuntimeStatus']>;

const defaultsOf = (value: ProviderDefaults | undefined): HarnessDefaults | undefined => value === undefined ? undefined : {
  ...(value.model ? { model: value.model } : {}),
  ...(value.reasoningEffort !== undefined ? { reasoningEffort: value.reasoningEffort } : {}),
  ...(value.serviceTier !== undefined ? { serviceTier: value.serviceTier } : {}),
  ...('approvalPreset' in value && value.approvalPreset ? { permission: value.approvalPreset } : 'permissionMode' in value && value.permissionMode ? { permission: value.permissionMode } : {}),
};
const identityOf = (data: ProviderSessionData): string => sessionConversationId(data);

/**
 * Korus's driver contract over the provider-neutral Harness: one class for every provider.
 * Product policy (instructions, MCP, review and share rules) is supplied by the caller.
 */
/** Korus agents seen by a driver, so provider-neutral hooks (instructions, MCP) can resolve the agent behind a session id. */
export type DriverPolicy = {
  coordinationPolicy?: ProviderCoordinationPolicy;
  agents?: AgentRegistry;
  /** Name a session carries into the provider; defaults to the agent name. */
  displayName?: (agent: Agent) => string;
  /** Product rules for a text generation (utility model, allowed MCP servers). */
  prepareGeneration?: (agent: Agent, input: ProviderTextGeneration) => ProviderTextGeneration;
  /** The scope a code review runs in, from its review MCP endpoint. */
  reviewScope?: (reviewMcpServerUrl: string) => ReviewScope;
};
type ProviderTextGeneration = Parameters<NonNullable<AgentProviderDriver['generateText']>>[1];
type ReviewScope = Parameters<NonNullable<AgentProviderDriver['executeScopedPrompt']>>[1]['scope'];

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  set(agent: Agent) { this.agents.set(agent.id, agent); }
  /** Scoped sessions are named `<agent>:scope:<id>`; they resolve to their owning agent. */
  get(sessionId: string): Agent { const agent = this.agents.get(sessionId.split(':scope:')[0]!); if (!agent) throw new Error(`Unknown agent for session ${sessionId}.`); return agent; }
}

export class HarnessAgentDriver implements AgentProviderDriver {
  private readonly sessions = new Map<string, Session>();
  /** The agent record each session follows; the provider sees later changes to it while an operation is in flight. */
  private readonly latest = new Map<string, Agent>();
  private readonly scopes = new Map<string, Session>();
  /** The scope an agent is running right now, which steering, interrupts and answers address instead of its own conversation. */
  private readonly running = new Map<string, Session>();
  /** The scoped run each agent has in flight, settled once it has fully unwound. */
  private readonly scopedRuns = new Map<string, Promise<void>>();
  /** Every scope open under an agent, released with it. */
  private readonly agentScopes = new Map<string, Set<Session>>();
  /** Scopes whose events stay out of the agent's conversation. */
  private readonly quiet = new Set<Session>();
  /** The agent each session's conversation belongs to: a scope reports as the agent it works for. */
  private readonly owners = new WeakMap<Session, string>();
  /** What each agent's readers last received. A different session or conversation starts them over with a snapshot. */
  private readonly published = new Map<string, { session: Session; conversation: string | null }>();
  /** A stream identity per session, so a reader can tell a restarted stream from a late one. */
  private readonly epochs = new WeakMap<Session, string>();
  private readonly recovering = new Set<Session>();
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly usageListeners = new Set<NonNullable<Parameters<NonNullable<AgentProviderDriver['onUsage']>>[0]>>();
  private readonly requestUsageListeners = new Set<NonNullable<Parameters<NonNullable<AgentProviderDriver['onRequestUsage']>>[0]>>();
  private readonly unsubscribe: () => void;

  constructor(
    readonly provider: HarnessProvider,
    private readonly harness: Harness,
    private readonly policy: DriverPolicy = {},
  ) {
    this.unsubscribe = harness.onEvent(event => this.forward(event));
  }

  get coordinationPolicy() { return this.policy.coordinationPolicy; }

  private forward(event: HarnessEvent): void {
    if (event.type === 'session.patch') this.publishConversation(event.session, event.patch);
    else if (event.type === 'recovery.required') void this.recover(event.session);
    else if (event.type === 'usage.observed') for (const listener of this.usageListeners) listener(this.attributed(event.observation));
    else if (event.type === 'requestUsage.observed') for (const listener of this.requestUsageListeners) listener(this.attributed(event.observation));
    else if (event.type !== 'session.changed') {
      const session = 'session' in event ? event.session : undefined;
      if (session && this.quiet.has(session)) return;
      const backend = this.backendEvent(event, session);
      if (backend) for (const listener of this.listeners) listener(backend);
    }
  }

  /**
   * The daemon event for a harness event. A scoped (review) session reports as the agent it works for, as the daemon
   * tracks one conversation per agent.
   */
  private backendEvent(event: Exclude<HarnessEvent, { type: 'session.changed' | 'session.patch' | 'recovery.required' | 'usage.observed' | 'requestUsage.observed' }>, session: Session | undefined): BackendEvent | undefined {
    const ownAgentId = 'agentId' in event && typeof event.agentId === 'string' ? event.agentId : undefined;
    const agentId = (session && this.owners.get(session)) ?? ownAgentId?.split(':scope:')[0];
    const provider = this.provider;
    switch (event.type) {
      case 'status.changed':
        if (!agentId) return undefined;
        return withStatusWording(provider, { type: 'agent.statusChanged', agentId, provider, payload: event.status.native ?? event.status } as BackendEvent);
      case 'request.created':
        return agentId ? { type: 'agentRequest.created', agentId, provider, ...(event.request.turnId ? { turnId: event.request.turnId } : {}), payload: { request: event.request } } : undefined;
      case 'request.resolved':
        return agentId ? { type: 'agentRequest.resolved', agentId, provider, payload: { id: event.id, outcome: event.outcome } } : undefined;
      case 'plan.readyForReview':
        return agentId ? { type: 'plan.readyForReview', agentId, provider, turnId: event.turnId,
          payload: { markdown: event.markdown, ...(event.itemId ? { itemId: event.itemId } : {}), ...(event.requestId ? { requestId: event.requestId } : {}) } } : undefined;
      case 'turn.started': case 'turn.completed': case 'session.error': case 'tool.updated': case 'turn.output': case 'diff.updated': case 'file.activity': {
        if (!agentId) return undefined;
        const { session: _session, type, turnId, conversationId, ...payload } = event;
        const scope = { agentId, provider, ...(turnId ? { turnId } : {}), ...(conversationId ? { conversationId } : {}) };
        return { type, ...scope, payload } as BackendEvent;
      }
      default: {
        const { session: _session, ...notice } = event;
        return withStatusWording(provider, (agentId ? { ...notice, agentId } : notice) as BackendEvent);
      }
    }
  }

  /** Publishes an agent's conversation as neutral session state: a snapshot when the reader has no base for a patch, otherwise the patch. */
  private publishConversation(session: Session, patch?: SessionPatch): void {
    const agentId = this.owners.get(session);
    if (agentId === undefined || this.quiet.has(session) || this.shownSession(agentId) !== session) return;
    const data = this.admittedData(session);
    const conversation = data ? identityOf(data) : null;
    let epoch = this.epochs.get(session);
    if (!epoch) { epoch = randomUUID(); this.epochs.set(session, epoch); }
    const last = this.published.get(agentId);
    const event: BackendEvent = patch && last?.session === session && last.conversation === conversation
      ? { type: 'conversation.sessionPatch', agentId, provider: this.provider, payload: { conversation, epoch, patch } }
      : { type: 'conversation.sessionSnapshot', agentId, provider: this.provider, payload: { conversation, epoch, snapshot: this.harness.readSessionSnapshot(session) } };
    this.published.set(agentId, { session, conversation });
    for (const listener of this.listeners) listener(event);
  }
  /** The one conversation an agent's readers see: the scope it is running, the review that continued its conversation, or its own. */
  private shownSession(agentId: string): Session | undefined {
    const running = this.running.get(agentId);
    if (running) return running;
    const stored = this.latest.get(agentId)?.providerSession;
    return (stored ? this.scopes.get(identityOf(stored)) : undefined) ?? this.sessions.get(agentId);
  }

  /** A provider stream that broke is repaired by reloading the conversation, which also hands readers a fresh snapshot. */
  private async recover(session: Session): Promise<void> {
    if (this.recovering.has(session) || !this.owners.has(session)) return;
    this.recovering.add(session);
    try {
      await this.harness.loadConversation(session);
    } catch {
      // The session state carries the error, which readers see in the snapshot below; their next load retries.
    } finally { this.recovering.delete(session); }
    this.publishConversation(session);
  }

  /** The Harness session for an agent, with Korus's stored identity, folder and defaults re-stated so the provider enforces its own checks against them. */
  private async session(agent: Agent): Promise<Session> { return this.peek(agent); }
  /** The current session for an agent without reopening, for synchronous reads such as capabilities. */
  private peek(agent: Agent): Session {
    this.policy.agents?.set(agent);
    this.latest.set(agent.id, agent);
    const session = this.sessions.get(agent.id);
    if (!session) return this.openFor(agent);
    this.restate(session, agent);
    return session;
  }
  /** The agent's record changed: its conversation, folder, name or defaults. An operation in flight sees the new values. */
  agentChanged(agent: Agent): void { this.peek(agent); }
  /** Tells the harness what the agent's record says now: the record is the authority on its conversation, folder, name and defaults. */
  private restate(session: Session, agent: Agent): void {
    this.harness.syncSession(session, { data: agent.providerSession ?? null, folder: agent.folder ?? null, name: this.nameOf(agent), defaults: defaultsOf(agent.providerDefaults) ?? {} });
  }
  private openFor(agent: Agent): Session {
    const stored = agent.providerSession;
    if (stored && stored.kind !== this.provider) throw new Error(`${providerDisplayName(this.provider)} conversation identity mismatch: it cannot use another provider conversation.`);
    const context = { id: agent.id, folder: agent.folder ?? null, name: this.nameOf(agent), defaults: defaultsOf(agent.providerDefaults) };
    const session = stored
      ? this.harness.restoreSession(context, { provider: this.provider, data: stored, ...(context.defaults ? { defaults: context.defaults } : {}), role: 'main' } satisfies SessionData)
      : this.harness.open(context);
    this.owners.set(session, agent.id);
    this.sessions.set(agent.id, session);
    return session;
  }
  /** Session data once the harness has admitted the session; undefined for a session that has not started yet. */
  /** A scoped session reports as the agent it works for. */
  private attributed<T extends { agentId?: string }>(observation: T): T { const id = observation.agentId; return id?.includes(':scope:') ? { ...observation, agentId: id.split(':scope:')[0] } : observation; }
  private nameOf(agent: Agent) { return this.policy.displayName?.(agent) ?? agent.name; }
  private admittedData(session: Session): ProviderSessionData | undefined { try { return this.harness.getSessionData(session).data; } catch { return undefined; } }
  private dataOf(session: Session): ProviderSessionData { return this.harness.getSessionData(session).data; }
  private ref(data: ProviderConversationRef) { return this.harness.restoreRef({ provider: this.provider, data }); }

  getRuntimeStatus(): ProviderRuntimeStatus {
    const runtime = this.harness.getRuntimeStatus();
    const detail = runtimeStatusDetail(this.provider, runtime.status, runtime.detail);
    return { ...runtime, ...(detail === undefined ? {} : { detail }), capabilities: { ...defaultProviderCapabilities(this.provider), ...this.liveCapabilities(this.harness.getProviderCapabilities()) } } as ProviderRuntimeStatus;
  }
  private liveCapabilities({ permissions: _permissions, login: _login, realtime: _realtime, remoteControl: _remoteControl, accountUsage: _accountUsage, ...rest }: ReturnType<Harness['getProviderCapabilities']>) { return rest; }
  authenticate(request: Parameters<NonNullable<AgentProviderDriver['authenticate']>>[0]) { return this.harness.authenticate(request).then(result => result.native as never); }
  getAccountRateLimits() { return this.harness.getAccountRateLimits(); }
  /**
   * What Korus offers on this harness (`provider-capabilities`), narrowed by what the session reports right now.
   * A read: it does not re-state the agent's record to the harness, which only an operation on the agent does.
   */
  getCapabilities(agent: Agent) {
    return { ...defaultProviderCapabilities(this.provider), ...this.liveCapabilities(this.harness.getCapabilities(this.sessions.get(agent.id) ?? this.openFor(agent))) } as ReturnType<AgentProviderDriver['getCapabilities']>;
  }
  /** Product wording for operations the provider does not offer. */
  private async unless<T>(agent: Agent, feature: string, run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) { throw error instanceof HarnessUnsupportedError ? unsupportedProviderFeature(agent, feature) : error; }
  }

  async sendPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) {
    const session = await this.session(agent);
    const { providerOptions: _providerOptions, recordUserMessage: _record, ...promptOptions } = options ?? {};
    const admission = await this.harness.sendPrompt(session, prompt, promptOptions as never);
    return { providerSession: this.dataOf(session), ...(admission.turnId ? { turnId: admission.turnId } : {}), ...(admission.messageId ? { messageId: admission.messageId } : {}) };
  }
  steerPrompt(agent: Agent, prompt: string, options?: SendPromptOptions) { return this.unless(agent, 'prompt steering', () => this.steer(agent, prompt, options)); }
  /** The session an operation addresses: the scope the agent is running, with the agent's saved conversation, or its own session. */
  private async target(agent: Agent): Promise<Session> {
    const scope = this.running.get(agent.id);
    if (!scope) return this.session(agent);
    this.latest.set(agent.id, agent);
    this.harness.syncSession(scope, { data: agent.providerSession ?? null });
    return scope;
  }
  private async steer(agent: Agent, prompt: string, options?: SendPromptOptions) {
    const session = await this.target(agent);
    const admission = await this.harness.steerPrompt(session, prompt, options as never);
    return { providerSession: this.dataOf(session), ...(admission.turnId ? { turnId: admission.turnId } : {}), ...(admission.messageId ? { messageId: admission.messageId } : {}) };
  }
  async interrupt(agent: Agent, expectedTurnId?: string) {
    const session = await this.target(agent);
    const run = this.scopedRuns.get(agent.id);
    const admission = await this.harness.interrupt(session, expectedTurnId);
    const providerSession = this.admittedData(session) ?? agent.providerSession!;
    // The harness acknowledges an interrupt before a scope's run has closed down its conversation. The caller may put
    // that conversation away next, so wait for the run; a run that will not stop is not waited on forever.
    if (run) await Promise.race([run, new Promise(resolve => setTimeout(resolve, 10_000))]);
    return { providerSession, ...(admission.turnId ? { turnId: admission.turnId } : {}) };
  }
  continueInterruptedTurn(agent: Agent, safetyReview?: Parameters<NonNullable<AgentProviderDriver['continueInterruptedTurn']>>[1]) {
    return this.unless(agent, 'interrupted turn continuation', async () => { const session = await this.session(agent); const result = await this.harness.continueInterruptedTurn(session, safetyReview); return { providerSession: this.dataOf(session), activeTurnId: result.activeTurnId }; });
  }
  async reconcileConversations(agents: Agent[]) { await this.harness.reconcileConversations(await Promise.all(agents.map(agent => this.session(agent)))); }
  /** A conversation can be handed off only when nothing is running or waiting on the person. */
  assertHandoffReady(agent: Agent) {
    return this.unless(agent, 'handoff readiness checks', async () => {
      const state = this.harness.readSession(await this.session(agent));
      if (state.busy || state.activeTurnId || state.requests.length) throw new Error(`Resolve the ${providerDisplayName(this.provider)} turn and requests before handing off.`);
    });
  }
  /** Worktree delegation is a Korus workflow: a native fork into the worker's folder, or null so Korus hands off instead. */
  async forkWorktreeConversation(agent: Agent, target: Agent) {
    if (!this.getCapabilities(agent).conversationFork) return null;
    return this.unless(agent, 'worktree conversation fork', async () => {
      const targetSession = await this.session(target);
      const result = await this.harness.forkConversation(await this.session(agent), targetSession);
      return result ? { providerSession: this.dataOf(targetSession) } : null;
    });
  }
  /** Null right away for an ordinary prompt, so callers can tell a command from a message without waiting. */
  tryHandlePromptCommand(agent: Agent, prompt: string) {
    const handled = this.harness.handlePromptCommand(this.peek(agent), prompt);
    return handled ? handled.then(admission => ({ providerSession: this.dataOf(this.peek(agent)), ...(admission.turnId ? { turnId: admission.turnId } : {}), ...(admission.messageId ? { messageId: admission.messageId } : {}) })) : null;
  }
  preparePromptOptions(agent: Agent, options?: SendPromptOptions) { return this.harness.preparePromptOptions(this.peek(agent), options as never) as SendPromptOptions | undefined; }
  async deleteTurn(agent: Agent, turnId: string) { const session = await this.session(agent); const result = await this.harness.deleteTurn(session, turnId); return { providerSession: this.dataOf(session), activeTurnId: result.activeTurnId }; }
  async editTurn(agent: Agent, turnId: string, content: string, options?: Pick<SendPromptOptions, 'content'>) { const session = await this.session(agent); const result = await this.harness.editTurn(session, turnId, content, options as never); return { providerSession: this.dataOf(session), activeTurnId: result.activeTurnId }; }
  async retryTurn(agent: Agent, turnId: string) { const session = await this.session(agent); const result = await this.harness.retryTurn(session, turnId); return { providerSession: this.dataOf(session), activeTurnId: result.activeTurnId }; }
  setGoal(agent: Agent, objective: string) { return this.unless(agent, 'goals', () => this.goal(agent, objective)); }
  private async goal(agent: Agent, objective: string) { const session = await this.session(agent); const result = await this.harness.setGoal(session, objective); return { providerSession: this.dataOf(session), ...(result.turnId ? { turnId: result.turnId } : {}), ...(result.goal ? { goal: result.goal } : {}) }; }
  clearGoal(agent: Agent) { return this.unless(agent, 'goals', () => this.clear(agent)); }
  private async clear(agent: Agent) { const session = await this.session(agent); const result = await this.harness.clearGoal(session); return { providerSession: this.dataOf(session), ...(result.cleared !== undefined ? { cleared: result.cleared } : {}) }; }
  async setConversationTitle(agent: Agent, title: string) { return this.harness.setConversationTitle(await this.session(agent), title); }
  async setPermissionMode(agent: Agent, mode: string) {
    const session = await this.session(agent);
    await this.harness.setPermission(session, mode);
    return { providerDefaults: { ...(agent.providerDefaults ?? { kind: this.provider }), permissionMode: mode } as ProviderDefaults };
  }
  /** The request may be pending in the agent's own session or in one of its scoped (review) sessions; without an agent, any session may hold it. */
  async respondToAgentRequest(response: Parameters<AgentProviderDriver['respondToAgentRequest']>[0]) {
    const { agentId, ...rest } = response;
    const candidates = agentId
      ? [...(this.sessions.get(agentId) ? [this.sessions.get(agentId)!] : []), ...[...this.scopes.values()].filter(scope => { try { return this.harness.getSessionData(scope).parentId === agentId; } catch { return false; } })]
      : [...this.sessions.values(), ...this.scopes.values()];
    const owner = candidates.find(session => this.harness.readSession(session).requests.some(request => request.id === rest.id));
    if (!owner) throw new Error('Request is not pending for this conversation.');
    return this.harness.respondToRequest(owner, rest);
  }

  async listModels(agent: Agent) { return this.harness.listModels(await this.session(agent)) as never; }
  async listSkills(agent: Agent, forceReload?: boolean) { return this.harness.listSkills(await this.session(agent), forceReload) as never; }
  async listPlugins(agent: Agent) { return this.harness.listPlugins(await this.session(agent)) as never; }
  async generateText(agent: Agent, input: ProviderTextGeneration) { return this.harness.generateText(await this.session(agent), (this.policy.prepareGeneration?.(agent, input) ?? input) as never); }
  async generateImage(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['generateImage']>>[1], signal?: AbortSignal) { return this.harness.generateImage(await this.session(agent), input as never, signal) as never; }

  async loadConversation(agent: Agent) {
    // While the agent runs a scope, such as a review, readers follow that scope. Its conversation is live there, so
    // loading it again under the agent's own session would only compete with the run.
    const running = this.running.get(agent.id);
    if (running) {
      this.latest.set(agent.id, agent);
      // A quiet scope, such as a summary, is never shown: readers keep the agent's own conversation as it stands.
      const shown = this.quiet.has(running) ? this.sessions.get(agent.id) : running;
      if (shown) this.publishConversation(shown);
      return (shown && this.admittedData(shown)) ?? agent.providerSession ?? null;
    }
    // When a review continued this very conversation, its history lives in the review's session.
    const own = agent.providerSession ? this.scopes.get(identityOf(agent.providerSession)) : undefined;
    const session = own ?? await this.session(agent);
    const loaded = await this.harness.loadConversation(session);
    // A reader that lost its place reloads; it starts again from this snapshot.
    this.publishConversation(session);
    return loaded ? this.dataOf(session) : null;
  }
  async loadOlderHistory(agent: Agent) { return { hasOlder: (await this.harness.loadOlderHistory(await this.session(agent))).hasOlder }; }
  async loadTurnHistory(agent: Agent, turnId: string) { return this.harness.loadTurnHistory(await this.session(agent), turnId); }
  async readConversationContent(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['readConversationContent']>>[1]) {
    const { sessionId: _sessionId, ...rest } = input;
    return this.harness.readConversationContent(await this.session(agent), rest);
  }
  async listConversations(agent: Agent, input?: Parameters<NonNullable<AgentProviderDriver['listConversations']>>[1]) {
    return (await this.harness.listConversations(await this.session(agent), input)).map(({ ref, ...summary }) => ({ ...summary, ref: this.harness.getRefData(ref).data })) as never;
  }
  async resumeConversation(agent: Agent, target: Parameters<NonNullable<AgentProviderDriver['resumeConversation']>>[1]) {
    const session = await this.session(agent);
    await this.harness.resumeConversation(session, { ref: this.ref(target.ref), storageState: target.storageState });
    return { providerSession: this.dataOf(session) };
  }
  forkConversation(agent: Agent, target: Agent, turnId?: string) {
    return this.unless(agent, 'conversation fork', async () => {
      const targetSession = await this.session(target);
      const result = await this.harness.forkConversation(await this.session(agent), targetSession, turnId);
      if (!result) throw new Error(`${providerDisplayName(this.provider)} cannot fork this conversation right now. Try again once the current turn finishes.`);
      return { providerSession: this.dataOf(targetSession) };
    });
  }
  readConversationMessages(ref: ProviderConversationRef, agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session) throw new Error('Unknown conversation.');
    return this.harness.readConversationMessages(session, this.ref(ref), { view: 'last' }) as never;
  }
  async readConversationSummary(agent: Agent, ref: ProviderConversationRef) {
    const found = await this.harness.readConversationSummary(await this.session(agent), this.ref(ref));
    return found ? { ...found, ref: this.harness.getRefData(found.ref).data } as never : null;
  }
  setConversationStorage(ref: ProviderConversationRef, state: 'active' | 'archived') { return this.harness.setConversationStorage(this.ref(ref), state); }
  async archiveAgentConversation(agent: Agent) { return this.harness.archiveConversation(await this.session(agent)); }
  async deleteAgentConversation(agent: Agent) { return this.harness.deleteConversation(await this.session(agent)); }
  async releaseConversation(agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session) return;
    // The harness releases a session only after the scopes opened under it, such as its reviews.
    for (const scope of [...this.agentScopes.get(agentId) ?? []]) await this.releaseScope(agentId, scope);
    await this.harness.release(session);
    // Forgotten only once the harness let go of it, so a refused release can be tried again.
    this.sessions.delete(agentId);
    if (this.published.get(agentId)?.session === session) this.published.delete(agentId);
  }
  /** Lets go of a scope without deleting its conversation: a saved review can still be continued later. */
  private async releaseScope(agentId: string, scope: Session): Promise<void> {
    await this.harness.release(scope);
    this.agentScopes.get(agentId)?.delete(scope);
    for (const [key, held] of this.scopes) if (held === scope) this.scopes.delete(key);
  }

  executeScopedPrompt(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['executeScopedPrompt']>>[1]) {
    const run = this.unless(agent, 'scoped execution', () => this.runScoped(agent, input));
    const settled = run.then(() => undefined, () => undefined);
    this.scopedRuns.set(agent.id, settled);
    void settled.then(() => { if (this.scopedRuns.get(agent.id) === settled) this.scopedRuns.delete(agent.id); });
    return run;
  }
  private async runScoped(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['executeScopedPrompt']>>[1]) {
    const parent = await this.session(agent);
    const existing = input.session ? this.scopes.get(identityOf(input.session)) : undefined;
    const scope = existing ?? (input.session
      ? this.harness.restoreSession({ id: `${agent.id}:scope:${randomUUID()}`, folder: input.cwd, defaults: defaultsOf(agent.providerDefaults) }, { provider: this.provider, data: input.session, role: 'scope', parentId: agent.id })
      : this.harness.openScope(parent, { cwd: input.cwd }));
    this.owners.set(scope, agent.id);
    this.running.set(agent.id, scope);
    if (!this.agentScopes.has(agent.id)) this.agentScopes.set(agent.id, new Set());
    this.agentScopes.get(agent.id)!.add(scope);
    if (input.silent) this.quiet.add(scope);
    let failed = false;
    try {
      const result = await this.harness.executeScopedPrompt(parent, { prompt: input.prompt, cwd: input.cwd, scope: input.scope, options: input.options as never, session: scope, ...(input.signal ? { signal: input.signal } : {}) });
      const data = this.dataOf(result.session);
      this.owners.set(result.session, agent.id);
      this.scopes.set(identityOf(data), result.session);
      return { text: result.text, session: data };
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (this.running.get(agent.id) === scope) this.running.delete(agent.id);
      this.quiet.delete(scope);
      // A scope opened for a run that failed is of no further use; one that was continued stays for its next round.
      if (failed && !existing) await this.releaseScope(agent.id, scope).catch(() => { this.agentScopes.get(agent.id)?.delete(scope); });
      // Readers saw the scope while it ran; they return to the conversation the agent shows now.
      const shown = this.shownSession(agent.id);
      if (shown && this.published.get(agent.id)?.session === scope && shown !== scope) this.publishConversation(shown);
    }
  }
  async disposeScopedSession(agent: Agent, session: ProviderSessionData) {
    const key = identityOf(session);
    let scope = this.scopes.get(key);
    if (!scope) {
      // A review saved by an earlier run: it can be released only while it is still the agent's own conversation.
      const own = this.sessions.get(agent.id) && this.admittedData(this.sessions.get(agent.id)!);
      if (own && identityOf(own) !== key) throw new Error(`${providerDisplayName(this.provider)} execution session changed.`);
      scope = this.harness.restoreSession({ id: `${agent.id}:scope:${randomUUID()}`, folder: agent.folder ?? null, defaults: defaultsOf(agent.providerDefaults) }, { provider: this.provider, data: session, role: 'scope', parentId: agent.id });
    }
    this.scopes.delete(key);
    await this.harness.disposeScopedSession(scope);
    this.agentScopes.get(agent.id)?.delete(scope);
  }
  async runCodeReview(agent: Agent, input: ProviderCodeReviewInput): Promise<ProviderCodeReviewResult> {
    const result = await this.executeScopedPrompt(agent, { prompt: input.prompt, cwd: input.cwd, ...(input.reviewerSession ? { session: input.reviewerSession } : {}),
      scope: (this.policy.reviewScope?.(input.reviewMcpServerUrl) ?? { id: input.reviewMcpServerUrl }) as never });
    return { text: result.text, reviewerSession: result.session };
  }
  disposeCodeReview(agent: Agent, session: ProviderSessionData) { return this.disposeScopedSession(agent, session); }

  onEvent(listener: (event: BackendEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onUsage(listener: NonNullable<AgentProviderDriver['onUsage']> extends (l: infer L) => unknown ? L : never) { this.usageListeners.add(listener as never); return () => { this.usageListeners.delete(listener as never); }; }
  onRequestUsage(listener: NonNullable<AgentProviderDriver['onRequestUsage']> extends (l: infer L) => unknown ? L : never) { this.requestUsageListeners.add(listener as never); return () => { this.requestUsageListeners.delete(listener as never); }; }
  async close() { this.unsubscribe(); this.listeners.clear(); await this.harness.close(); }
}
