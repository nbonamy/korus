import { PromptRejectedError } from './prompt-rejected';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';
import type { AgentBackendDriver, BackendEvent, BackendSendResult } from '@workspace/core/backend-driver';
import type { Agent, AppSnapshot, SendPromptOptions } from '@workspace/core/contracts';
import { createEntityId } from '@workspace/core/ids';
import { handoffInProgress } from '@workspace/core/agent-handoff';

export type AgentPromptManagerOptions = {
  getSnapshot: () => AppSnapshot;
  driverForAgent: (agent: Agent) => AgentBackendDriver;
  applyEvent: (event: BackendEvent) => void;
  persistSnapshot: () => Promise<unknown>;
  setNewConversationTitle: (agentId: string, wasNewSession: boolean) => void;
  onPromptStarting?: (agentId: string, options?: SendPromptOptions) => void;
  isEngineConnected?: (agent: Agent) => boolean;
};

/** Owns prompt admission, queued delivery, and bounded retry scheduling. */
export class AgentPromptManager {
  private readonly inFlightQueuedPrompts = new Set<string>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: AgentPromptManagerOptions) {}

  canStart(agent: Agent): boolean {
    return canStartPrompt(agent);
  }

  sendAndWaitForAcceptance(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<void> {
    return this.sendWithReceipt(agent, prompt, options).then(() => undefined);
  }

  sendWithReceipt(agent: Agent, prompt: string, options?: SendPromptOptions): Promise<BackendSendResult> {
    if (!canStartPrompt(agent)) return Promise.reject(new PromptRejectedError('Agent is busy. Try the review decision again when idle.'));
    return new Promise((resolve, reject) => {
      this.start(agent, prompt, options, undefined, { resolve, reject });
    });
  }

  send(agentId: string, prompt: string, promptOptions?: SendPromptOptions): AppSnapshot {
    const snapshot = this.options.getSnapshot();
    const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return snapshot;
    if (handoffInProgress(agent)) throw new Error('Wait for the handoff to finish.');
    if (this.options.isEngineConnected?.(agent) === false) throw new Error('Engine is not connected. Reconnect in Settings.');

    if (!canStartPrompt(agent)) {
      this.options.applyEvent({
        agentId,
        type: 'agent.promptQueued',
        payload: {
          id: createEntityId('prompt'),
          text: prompt.trim(),
          ...(promptOptions ? { options: promptOptions } : {}),
        },
      });
      return snapshot;
    }

    return this.start(agent, prompt, promptOptions);
  }

  startQueued(agent: Agent, promptId: string, replacement?: string): AppSnapshot {
    const snapshot = this.options.getSnapshot();
    const queued = (snapshot.queuedPrompts ?? []).find((candidate) => (
      candidate.agentId === agent.id && candidate.id === promptId
    ));
    if (!queued) return snapshot;
    return this.start(agent, replacement ?? queued.text, queued.options, queued.id);
  }

  drain(agentId: string): void {
    const snapshot = this.options.getSnapshot();
    const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
    if (!agent || !canStartPrompt(agent)) return;
    const queued = (snapshot.queuedPrompts ?? []).find((candidate) => candidate.agentId === agentId);
    if (!queued) return;
    if (queued.retryAt) {
      const delay = Date.parse(queued.retryAt) - Date.now();
      if (delay > 0) {
        this.installRetry(agentId, queued.id, delay);
        return;
      }
    }
    this.start(agent, queued.text, queued.options, queued.id);
  }

  dequeue(agentId: string, promptId: string): void {
    this.inFlightQueuedPrompts.delete(queuedPromptKey(agentId, promptId));
    this.clearRetry(promptId);
    this.options.applyEvent({ agentId, type: 'agent.promptDequeued', payload: { ids: [promptId] } });
  }

  close(): void {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.inFlightQueuedPrompts.clear();
  }

  private start(agent: Agent, prompt: string, promptOptions?: SendPromptOptions, queuedPromptId?: string, acceptance?: { resolve: (receipt: BackendSendResult) => void; reject: (error: Error) => void }): AppSnapshot {
    const snapshot = this.options.getSnapshot();
    if (this.options.isEngineConnected?.(agent) === false) {
      acceptance?.reject(new PromptRejectedError('Engine is not connected. Reconnect in Settings.'));
      return snapshot;
    }
    const inFlightKey = queuedPromptId ? queuedPromptKey(agent.id, queuedPromptId) : undefined;
    if (inFlightKey && this.inFlightQueuedPrompts.has(inFlightKey)) return snapshot;
    if (queuedPromptId) this.clearRetry(queuedPromptId);
    const queuedPrompt = queuedPromptId
      ? (snapshot.queuedPrompts ?? []).find((candidate) => candidate.id === queuedPromptId)
      : undefined;
    if (inFlightKey) this.inFlightQueuedPrompts.add(inFlightKey);
    this.options.onPromptStarting?.(agent.id, promptOptions);

    try {
      return sendAgentPrompt(
        snapshot,
        this.options.driverForAgent(agent),
        agent.id,
        prompt,
        promptOptions,
        this.options.applyEvent,
        {
          appendUserMessage: !queuedPrompt || (!queuedPrompt.submitted && (queuedPrompt.attempts ?? 0) === 0),
          onBackendSessionUpdated: async (_result, wasNewSession) => {
            this.options.setNewConversationTitle(agent.id, wasNewSession);
            await this.options.persistSnapshot();
          },
          onPromptStarted: result => {
            if (queuedPromptId) this.dequeue(agent.id, queuedPromptId);
            acceptance?.resolve(result);
          },
          onPromptFailed: (error) => {
            acceptance?.reject(error);
            if (queuedPromptId) {
              this.inFlightQueuedPrompts.delete(queuedPromptKey(agent.id, queuedPromptId));
              this.scheduleRetry(agent.id, queuedPromptId, error);
            }
          },
        },
      );
    } catch (error) {
      if (inFlightKey) this.inFlightQueuedPrompts.delete(inFlightKey);
      throw error;
    }
  }

  private scheduleRetry(agentId: string, promptId: string, error: Error): void {
    const queued = (this.options.getSnapshot().queuedPrompts ?? []).find((candidate) => (
      candidate.agentId === agentId && candidate.id === promptId
    ));
    if (!queued) return;
    const attempts = (queued.attempts ?? 0) + 1;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(attempts - 1, 5)));
    const retryAt = new Date(Date.now() + delay).toISOString();
    this.options.applyEvent({
      agentId,
      type: 'agent.promptRetryScheduled',
      payload: { id: promptId, attempts, lastError: error.message, retryAt },
    });
    this.installRetry(agentId, promptId, delay);
  }

  private installRetry(agentId: string, promptId: string, delay: number): void {
    if (this.retryTimers.has(promptId)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(promptId);
      const snapshot = this.options.getSnapshot();
      const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
      const head = (snapshot.queuedPrompts ?? []).find((candidate) => candidate.agentId === agentId);
      if (agent && canStartPrompt(agent) && head?.id === promptId) {
        this.start(agent, head.text, head.options, head.id);
      }
    }, Math.max(0, delay));
    timer.unref?.();
    this.retryTimers.set(promptId, timer);
  }

  private clearRetry(promptId: string): void {
    const timer = this.retryTimers.get(promptId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(promptId);
  }
}

function canStartPrompt(agent: Agent): boolean {
  return !handoffInProgress(agent) && agent.status.type !== 'working' && agent.status.type !== 'awaitingInput';
}

function queuedPromptKey(agentId: string, promptId: string): string {
  return `${agentId}:${promptId}`;
}
