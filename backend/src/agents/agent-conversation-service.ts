import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type {
  Agent,
  AppSnapshot,
  BackendConversationRef,
  BackendSession,
} from '@workspace/core/contracts';
import type { BackendEvent, BackendTurnActionResult } from '@workspace/core/backend-driver';
import { formatConversationTitle, shouldSyncConversationTitleFromAgent } from '@workspace/core/conversation-title';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { warnMain } from '../log';

export type AgentConversationServiceOptions = {
  applyEvent: (event: BackendEvent) => void;
  driverRequest: (agent: Agent, method: string, params: unknown) => Promise<unknown>;
  getSnapshot: () => AppSnapshot;
  persistSnapshot: () => Promise<AppSnapshot>;
  refreshGitStatus: (agentId: string) => Promise<void>;
  refreshWorkspaceIdentity: (agentId: string) => Promise<void>;
};

/** Owns conversation turn actions, hydration, and title synchronization. */
export class AgentConversationService {
  private readonly hydrationRequests = new Map<string, Promise<void>>();

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

  async editTurn(agentId: string, turnId: string, content: string): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const result = await this.options.driverRequest(
      agent,
      backendMethods.driverTurnEdit,
      { agent, turnId, content },
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

  async continueInterruptedTurn(agentId: string): Promise<AppSnapshot | null> {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const result = await this.options.driverRequest(
      agent,
      backendMethods.driverTurnContinueInterrupted,
      { agent },
    ) as BackendTurnActionResult;
    return this.applyTurnAction(agentId, result);
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

  async hydrate(agentId: string): Promise<void> {
    const existing = this.hydrationRequests.get(agentId);
    if (existing) return existing;
    const request = this.performHydration(agentId).finally(() => {
      if (this.hydrationRequests.get(agentId) === request) {
        this.hydrationRequests.delete(agentId);
      }
    });
    this.hydrationRequests.set(agentId, request);
    return request;
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
    }
  }

  private async hydrateSessionWithTransientRetry(agentId: string, agent: Agent): Promise<unknown> {
    try {
      return await this.options.driverRequest(agent, backendMethods.driverConversationLoad, { agent });
    } catch (error) {
      if (!isTransientHistoryHydrationError(error)) throw error;
      await delay(HISTORY_HYDRATION_RETRY_DELAY_MS);
      const retryAgent = this.agent(agentId);
      if (!retryAgent?.backendSession) return undefined;
      return this.options.driverRequest(retryAgent, backendMethods.driverConversationLoad, { agent: retryAgent });
    }
  }

  async hydrateAndRefresh(agentId: string): Promise<void> {
    await this.hydrate(agentId);
    await this.options.refreshWorkspaceIdentity(agentId);
    await this.options.refreshGitStatus(agentId);
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

const HISTORY_HYDRATION_RETRY_DELAY_MS = 500;

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
