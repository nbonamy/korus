import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type {
  Agent,
  PromptContentOptions,
  AppSnapshot,
  BackendConversationRef,
  BackendSession,
} from '@workspace/core/contracts';
import type { BackendEvent, BackendTurnActionResult } from '@workspace/core/backend-driver';
import { formatConversationTitle, shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { debugMain, warnMain } from '../log';
import { conversationWriterDiagnostics } from './conversation-writer-diagnostics';

export type AgentConversationServiceOptions = {
  applyEvent: (event: BackendEvent) => void;
  driverRequest: (agent: Agent, method: string, params: unknown) => Promise<unknown>;
  getSnapshot: () => AppSnapshot;
  persistSnapshot: () => Promise<AppSnapshot>;
  refreshGitStatus: (agentId: string) => Promise<void>;
  refreshWorkspaceIdentity: (agentId: string) => Promise<void>;
  writerDiagnostics?: () => Promise<Record<string, unknown>>;
};

/** Owns conversation turn actions, hydration, and title synchronization. */
export class AgentConversationService {
  private readonly hydrationRequests = new Map<string, Promise<void>>();
  private readonly conversationOperations = new Map<string, Promise<unknown>>();

  constructor(private readonly options: AgentConversationServiceOptions) {}

  async deleteTurn(agentId: string, turnId: string): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const result = await this.options.driverRequest(
      agent,
      backendMethods.driverTurnDelete,
      { agent, turnId },
    ) as BackendTurnActionResult;
    return this.applyTurnAction(agentId, result);
  }

  async editTurn(agentId: string, turnId: string, content: string, options?: PromptContentOptions): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const result = await this.options.driverRequest(
      agent,
      backendMethods.driverTurnEdit,
      { agent, turnId, content, ...(options ? { options } : {}) },
    ) as BackendTurnActionResult;
    return this.applyTurnAction(agentId, result);
  }

  async retryTurn(agentId: string, turnId: string): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const result = await this.options.driverRequest(
      agent,
      backendMethods.driverTurnRetry,
      { agent, turnId },
    ) as BackendTurnActionResult;
    return this.applyTurnAction(agentId, result);
  }

  async continueInterruptedTurn(agentId: string, shouldContinue?: () => boolean): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    return this.withConversations([agent], 'continue interrupted work', async () => {
      const action = () => this.options.driverRequest(agent, backendMethods.driverTurnContinueInterrupted, { agent }) as Promise<BackendTurnActionResult>;
      const result = shouldContinue ? await this.retryTransient('continue interrupted work', [agent], action, shouldContinue) : await action();
      return result ? this.applyTurnAction(agentId, result) : null;
    });
  }

  async reconcile(agents: Agent[], action: () => Promise<void>): Promise<void> {
    await this.withConversations(agents, 'reconcile archives', () => this.retryTransient('reconcile archives', agents, action));
  }

  isStoredConversationRef(ref: BackendConversationRef, agentId: string): boolean {
    const snapshot = this.options.getSnapshot();
    const storedAutomationConversation = snapshot.automations.some((automation) => automation.executionLog.some((entry) => (
      entry.agentId === agentId &&
      Boolean(entry.conversationRef && sameConversationRef(entry.conversationRef, ref))
    )));
    if (storedAutomationConversation) return true;
    const agent = this.agent(agentId);
    if (agent?.handoff && sameConversationRef(agent.handoff.sourceRef, ref)) return true;
    const tree = snapshot.subagentTrees[agentId];
    if (ref.backend === 'claude' && agent?.backendSession?.kind === 'claude') {
      const root = conversationRefFromAgent(agent);
      return tree?.rootConversationId === agent.backendSession.sessionId && root?.backend === 'claude'
        && root.folder === ref.folder && root.sessionId === ref.sessionId
        && ref.subagentId !== undefined && Boolean(tree.nodes[ref.subagentId]);
    }
    return ref.backend === 'codex' &&
      agent?.backendSession?.kind === 'codex' &&
      tree?.rootConversationId === agent.backendSession.threadId &&
      Boolean(tree.nodes[ref.threadId]);
  }

  async hydrate(agentId: string, reportFailure = false): Promise<void> {
    let request = this.hydrationRequests.get(agentId);
    if (!request) {
      const agent = this.agent(agentId);
      if (!agent?.backendSession) return;
      const pending = this.withConversations([agent], 'load history', () => this.performHydration(agentId)).finally(() => {
        if (this.hydrationRequests.get(agentId) === pending) this.hydrationRequests.delete(agentId);
      });
      this.hydrationRequests.set(agentId, pending);
      request = pending;
    }
    try { await request; }
    catch (error) { if (reportFailure) throw error; }
  }

  private async performHydration(agentId: string): Promise<void> {
    const agent = this.agent(agentId);
    if (!agent?.backendSession) return;
    try {
      const session = await this.hydrateSessionWithTransientRetry(agentId, agent);
      if (isBackendSession(session)) {
        agent.backendSession = session;
        await this.options.persistSnapshot();
      }
    } catch (error) {
      warnMain('agent-conversation', 'history hydration failed', {
        agentId,
        backend: agent.backend,
        message: error instanceof Error ? error.message : String(error),
      });
      this.options.applyEvent({
        agentId,
        type: 'conversation.historyLoadFailed',
        conversationId: agent.backendSession.kind === 'codex' ? agent.backendSession.threadId : agent.backendSession.sessionId,
        payload: { error: 'Unable to load conversation history.' },
      });
      throw new Error('Unable to load conversation history.');
    }
  }

  private async hydrateSessionWithTransientRetry(agentId: string, agent: Agent): Promise<unknown> {
    return this.retryTransient('load history', [agent], async () => {
      const retryAgent = this.agent(agentId);
      if (!retryAgent?.backendSession) return undefined;
      return this.options.driverRequest(retryAgent, backendMethods.driverConversationLoad, { agent: retryAgent });
    });
  }

  async hydrateAndRefresh(agentId: string, reportFailure = false): Promise<void> {
    await this.hydrate(agentId, reportFailure);
    await this.options.refreshWorkspaceIdentity(agentId);
    await this.options.refreshGitStatus(agentId);
  }

  private async withConversations<T>(agents: Agent[], operation: string, action: () => Promise<T>): Promise<T> {
    const keys = [...new Set(agents.map(conversationKey))];
    const previous = keys.flatMap(key => this.conversationOperations.get(key) ?? []);
    if (previous.length) debugMain('agent-conversation', 'waiting for conversation operation', { operation, conversations: keys, daemonPid: process.pid });
    const pending = Promise.all(previous.map(request => request.catch(() => undefined))).then(action);
    for (const key of keys) this.conversationOperations.set(key, pending);
    try { return await pending; }
    finally { for (const key of keys) if (this.conversationOperations.get(key) === pending) this.conversationOperations.delete(key); }
  }

  private async retryTransient<T>(operation: string, agents: Agent[], action: () => Promise<T>, shouldContinue = () => true): Promise<T | undefined> {
    for (let attempt = 0; shouldContinue(); attempt++) {
      try { return await action(); }
      catch (error) {
        if (!shouldContinue()) return undefined;
        const retryLimit = /already has an active writer/i.test(String(error)) ? HISTORY_RETRY_DELAYS_MS.length : 1;
        if (!isTransientHistoryHydrationError(error) || attempt >= retryLimit) throw error;
        if (attempt === 0 && /already has an active writer/i.test(String(error))) {
          const diagnostics = await (this.options.writerDiagnostics ?? conversationWriterDiagnostics)().catch(() => ({ inspectionFailed: true }));
          warnMain('agent-conversation', 'conversation writer conflict', { operation, conversations: agents.map(conversationKey), daemonPid: process.pid, ...diagnostics });
        }
        warnMain('agent-conversation', 'retrying conversation operation', {
          operation, conversations: agents.map(conversationKey), daemonPid: process.pid,
          attempt: attempt + 1, delayMs: HISTORY_RETRY_DELAYS_MS[attempt], message: String(error),
        });
        await delay(HISTORY_RETRY_DELAYS_MS[attempt]!);
      }
    }
    return undefined;
  }

  setNewTitle(agentId: string, wasNewSession: boolean): void {
    if (wasNewSession) this.setTitle(agentId);
  }

  setTitle(agentId: string): void {
    const agent = this.agent(agentId);
    if (!agent || !shouldSyncConversationTitleFromAgent(agent)) return;
    agent.conversationTitle = formatConversationTitle(agent);
    void this.syncTitle(agentId);
  }

  async syncTitle(agentId: string): Promise<void> {
    const agent = this.agent(agentId);
    if (!agent) return;
    try {
      await this.options.driverRequest(agent, backendMethods.driverConversationTitleUpdate, {
        agent,
        title: agent.conversationTitle ?? formatConversationTitle(agent),
      });
    } catch {
      // A title failure should not fail the user action that created the session.
    }
  }

  private agent(agentId: string): Agent | undefined {
    return this.options.getSnapshot().agents.find((candidate) => candidate.id === agentId);
  }

  private async applyTurnAction(agentId: string, result: BackendTurnActionResult): Promise<AppSnapshot> {
    const agent = this.agent(agentId);
    if (agent) agent.backendSession = result.backendSession;
    this.options.applyEvent({
      agentId,
      ...(result.backendSession.kind === 'codex' ? { threadId: result.backendSession.threadId } : {}),
      type: 'agent.statusChanged',
      payload: result.activeTurnId ? { type: 'working' } : { type: 'idle' },
    });
    return this.options.persistSnapshot();
  }
}

const HISTORY_RETRY_DELAYS_MS = [1000, 2000, 4000];

function conversationKey(agent: Agent): string {
  const session = agent.backendSession;
  return JSON.stringify(session?.kind === 'codex' ? ['codex', session.threadId]
    : session ? [session.kind, agent.folder, session.sessionId] : ['agent', agent.id]);
}

function isTransientHistoryHydrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /request timed out: thread\/resume/i.test(message) || /already has an active writer/i.test(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameConversationRef(left: BackendConversationRef, right: BackendConversationRef): boolean {
  return left.backend === right.backend && (
    left.backend === 'codex'
      ? right.backend === 'codex' && left.threadId === right.threadId
      : right.backend === left.backend && left.folder === right.folder && left.sessionId === right.sessionId
        && (left.backend !== 'claude' || right.backend !== 'claude' || left.subagentId === right.subagentId)
  );
}

function isBackendSession(value: unknown): value is BackendSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  if (session.kind === 'codex') {
    return typeof session.threadId === 'string' && session.threadId.trim().length > 0;
  }
  if (session.kind === 'antigravity') return typeof session.sessionId === 'string' && session.sessionId.trim().length > 0;
  return session.kind === 'claude' &&
    typeof session.sessionId === 'string' &&
    session.sessionId.trim().length > 0 &&
    typeof session.transport === 'string';
}
