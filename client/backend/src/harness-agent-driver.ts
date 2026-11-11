import { randomUUID } from 'node:crypto';
import { runtimeStatusDetail, withStatusWording } from './provider-status-wording';
import type { Harness, HarnessDefaults, HarnessEvent, Session, SessionData } from '@korus-dev/multi-agent-sdk';
import type { Agent, HarnessProvider, ProviderConversationRef, ProviderDefaults, ProviderSessionData, SendPromptOptions } from '@workspace/core/contracts';
import type { AgentProviderDriver, BackendEvent, ProviderCodeReviewInput, ProviderCodeReviewResult, ProviderCoordinationPolicy } from '@workspace/core/provider-driver';
import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import { providerDisplayName, unsupportedProviderFeature } from '@workspace/core/provider-driver';
import { HarnessUnsupportedError } from '@korus-dev/multi-agent-sdk';

type ProviderRuntimeStatus = ReturnType<AgentProviderDriver['getRuntimeStatus']>;

const defaultsOf = (value: ProviderDefaults | undefined): HarnessDefaults | undefined => value === undefined ? undefined : {
  ...(value.model ? { model: value.model } : {}),
  ...(value.reasoningEffort !== undefined ? { reasoningEffort: value.reasoningEffort } : {}),
  ...(value.serviceTier !== undefined ? { serviceTier: value.serviceTier } : {}),
  ...('approvalPreset' in value && value.approvalPreset ? { permission: value.approvalPreset } : 'permissionMode' in value && value.permissionMode ? { permission: value.permissionMode } : {}),
};
const identityOf = (data: ProviderSessionData): string => data.kind === 'codex' ? data.threadId : data.sessionId;

/**
 * Korus's driver contract over the provider-neutral Harness: one class for every provider.
 * Product policy (instructions, MCP, review and share rules) is supplied by the caller.
 */
/** Korus agents seen by a driver, so provider-neutral hooks (instructions, MCP) can resolve the agent behind a session id. */
export type DriverPolicy = {
  coordinationPolicy?: ProviderCoordinationPolicy;
  /** Product capabilities layered over what the provider reports. */
  capabilities?: (agent: Agent) => Partial<ReturnType<AgentProviderDriver['getCapabilities']>>;
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
  /** Scopes whose events stay out of the agent's conversation. */
  private readonly quiet = new Set<Session>();
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
    if (event.type === 'provider.event') {
      if (event.session && this.quiet.has(event.session)) return;
      // A scoped (review) session reports as the agent it works for, as the daemon tracks one conversation per agent.
      const agentId = (event.event as { agentId?: string }).agentId;
      const parent = agentId?.includes(':scope:') ? agentId.split(':scope:')[0] : undefined;
      const frame = withStatusWording(this.provider, (parent ? { ...event.event, agentId: parent } : event.event) as unknown as BackendEvent);
      for (const listener of this.listeners) listener(frame);
    }
    else if (event.type === 'usage.observed') for (const listener of this.usageListeners) listener(this.attributed(event.observation));
    else if (event.type === 'requestUsage.observed') for (const listener of this.requestUsageListeners) listener(this.attributed(event.observation));
  }

  /** The Harness session for an agent, with Korus's stored identity, folder and defaults re-stated so the provider enforces its own checks against them. */
  private async session(agent: Agent): Promise<Session> {
    this.policy.agents?.set(agent);
    this.latest.set(agent.id, agent);
    return this.sessions.get(agent.id) ?? this.openFor(agent);
  }
  /** The current session for an agent without reopening, for synchronous reads such as capabilities. */
  private peek(agent: Agent): Session { this.policy.agents?.set(agent); this.latest.set(agent.id, agent); return this.sessions.get(agent.id) ?? this.openFor(agent); }
  private openFor(agent: Agent): Session {
    const stored = agent.providerSession;
    if (stored && stored.kind !== this.provider) throw new Error(`${providerDisplayName(this.provider)} conversation identity mismatch: it cannot use another provider conversation.`);
    const context = { id: agent.id, folder: agent.folder ?? null, name: this.nameOf(agent), defaults: defaultsOf(agent.providerDefaults) };
    const session = stored
      ? this.harness.restoreSession(context, { provider: this.provider, data: stored, ...(context.defaults ? { defaults: context.defaults } : {}), role: 'main' } satisfies SessionData)
      : this.harness.open(context);
    this.harness.bindSession(session, () => { const current = this.latest.get(agent.id) ?? agent; return { data: current.providerSession ?? null, folder: current.folder ?? null, name: this.nameOf(current), defaults: defaultsOf(current.providerDefaults) ?? {} }; });
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
  getCapabilities(agent: Agent) {
    return { ...defaultProviderCapabilities(this.provider), ...this.liveCapabilities(this.harness.getCapabilities(this.peek(agent))), ...this.policy.capabilities?.(agent) } as ReturnType<AgentProviderDriver['getCapabilities']>;
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
    const admission = await this.harness.interrupt(session, expectedTurnId);
    return { providerSession: this.dataOf(session), ...(admission.turnId ? { turnId: admission.turnId } : {}) };
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
    // When a review continued this very conversation, its history lives in the review's session.
    const own = agent.providerSession ? this.scopes.get(identityOf(agent.providerSession)) : undefined;
    const session = own ?? await this.session(agent);
    return await this.harness.loadConversation(session) ? this.dataOf(session) : null;
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
    this.sessions.delete(agentId);
    await this.harness.release(session);
  }

  executeScopedPrompt(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['executeScopedPrompt']>>[1]) { return this.unless(agent, 'scoped execution', () => this.runScoped(agent, input)); }
  private async runScoped(agent: Agent, input: Parameters<NonNullable<AgentProviderDriver['executeScopedPrompt']>>[1]) {
    const parent = await this.session(agent);
    const existing = input.session ? this.scopes.get(identityOf(input.session)) : undefined;
    const scope = existing ?? (input.session
      ? this.harness.restoreSession({ id: `${agent.id}:scope:${randomUUID()}`, folder: input.cwd, defaults: defaultsOf(agent.providerDefaults) }, { provider: this.provider, data: input.session, role: 'scope', parentId: agent.id })
      : this.harness.openScope(parent, { cwd: input.cwd }));
    this.running.set(agent.id, scope);
    if (input.silent) this.quiet.add(scope);
    try {
      const result = await this.harness.executeScopedPrompt(parent, { prompt: input.prompt, cwd: input.cwd, scope: input.scope, options: input.options as never, session: scope, ...(input.signal ? { signal: input.signal } : {}) });
      const data = this.dataOf(result.session);
      this.scopes.set(identityOf(data), result.session);
      return { text: result.text, session: data };
    } finally {
      if (this.running.get(agent.id) === scope) this.running.delete(agent.id);
      this.quiet.delete(scope);
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
