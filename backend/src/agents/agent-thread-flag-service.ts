import type { Agent } from '@workspace/core/contracts';
import { normalizeThreadFlagId, normalizeThreadFlags, type ThreadFlagResponse } from '@workspace/core/thread-flags';
import { PROPOSED_WORK_DELEGATION_PROMPT } from './worktree-delegation';
import { MISSION_COMMAND_PROMPT } from './mission-command';

export class AgentThreadFlagService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly options: {
    submit: (agent: Agent, prompt: string) => Promise<void>;
  }) {}

  async respond(agent: Agent, response: ThreadFlagResponse): Promise<void> {
    const id = normalizeThreadFlagId(response.id);
    if (!agent.threadFlags || normalizeThreadFlags(agent.threadFlags)[id] !== true) {
      throw new Error('This thread flag is no longer active.');
    }
    const allowedActions = id === 'work_proposed'
      ? ['implement', 'delegate', 'create_mission', 'dismiss', ...(response.id === 'delegate_to_worktree' ? ['execute'] : [])]
      : ['execute', 'dismiss'];
    if (!allowedActions.includes(response.action)) {
      throw new Error('Invalid thread flag action.');
    }
    const key = `${agent.id}:${id}`;
    if (this.inFlight.has(key)) throw new Error('This thread flag is already being handled.');
    const originalFlags = agent.threadFlags;

    this.inFlight.add(key);
    try {
      if (id === 'work_proposed' && response.action === 'implement') {
        await this.options.submit(agent, 'Implement the proposed work in this conversation using the current agent and workspace.');
      }
      if (id === 'work_proposed' && (response.action === 'delegate' || response.action === 'execute')) {
        await this.options.submit(agent, PROPOSED_WORK_DELEGATION_PROMPT);
      }
      if (id === 'work_proposed' && response.action === 'create_mission') {
        await this.options.submit(agent, MISSION_COMMAND_PROMPT);
      }
      // Turn startup may consume the old flag or publish a new one before admission replies.
      if (agent.threadFlags !== originalFlags) return;
      const threadFlags = normalizeThreadFlags(agent.threadFlags);
      delete threadFlags[id];
      agent.threadFlags = Object.keys(threadFlags).length > 0 ? threadFlags : undefined;
      agent.updatedAt = new Date().toISOString();
    } finally {
      this.inFlight.delete(key);
    }
  }
}
