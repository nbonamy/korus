import { product } from '@workspace/core/product';
import type { Agent, AppSnapshot, CreateAgentInput } from '@workspace/core/contracts';
import { agentHandoffBlocker, handoffInProgress, handoffNoteLimit, type AgentHandoff, type AgentHandoffInput } from '@workspace/core/agent-handoff';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import { resolveAgentProvider } from '@workspace/core/agent-providers';
import { closeAgentInSnapshot } from '@workspace/core/agent-manager';
import { providerDisplayName } from '@workspace/core/provider-driver';

type Options = {
  snapshot: AppSnapshot;
  create(input: CreateAgentInput): Agent;
  persist(): Promise<unknown>;
  requestNote(agent: Agent, prompt: string): Promise<string>;
  assertReady(agent: Agent): Promise<void>;
  checkDelegates?(agent: Agent): Promise<void>;
  replaced?(source: Agent, target: Agent): Promise<void>;
  abandoned?(source: Agent): void;
  retire(agent: Agent): Promise<void>;
  start(agent: Agent, prompt: string): Promise<void>;
};

/** Replaces a App worker; provider history and the workspace remain provider/filesystem owned. */
export class AgentHandoffService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly options: Options) {}

  run(sourceId: string, input: AgentHandoffInput): Promise<void> {
    const key = `${sourceId}:${input.operationId}`;
    const previous = this.running.get(key);
    const existing = this.options.snapshot.agents.find(agent => agent.handoff?.sourceAgentId === sourceId && agent.handoff.operationId === input.operationId)?.handoff;
    if (existing) {
      if (JSON.stringify(existing.selection) !== JSON.stringify(input.selection) || existing.instructions !== input.instructions) return Promise.reject(new Error('Handoff request changed. Open Hand off again.'));
      if (previous) return previous;
      return existing.phase === 'complete' ? Promise.resolve() : Promise.reject(new Error(existing.phase === 'failed' ? 'The handoff did not finish.' : 'Handoff already in progress.'));
    }
    const operation = this.perform(sourceId, input);
    this.running.set(key, operation);
    void operation.finally(() => this.running.delete(key)).catch(() => undefined);
    return operation;
  }

  async recover(): Promise<void> {
    let changed = false;
    for (const agent of this.options.snapshot.agents) {
      const handoff = agent.handoff;
      if (!handoff || handoff.phase === 'complete') continue;
      if (!handoff.targetAgentId) { this.abandon(agent); changed = true; continue; }
      if (!handoffInProgress(agent)) continue;
      handoff.phase = 'failed';
      changed = true;
    }
    if (changed) await this.options.persist();
  }

  /** Without a replacement nothing changed, so the handoff leaves no trace and the next one starts over. */
  private abandon(source: Agent): void {
    delete source.handoff;
    this.options.abandoned?.(source);
  }

  private async perform(sourceId: string, input: AgentHandoffInput): Promise<void> {
    const { snapshot } = this.options;
    const source = snapshot.agents.find(agent => agent.id === sourceId);
    if (!source) throw new Error('Source agent is no longer available.');
    const blocker = agentHandoffBlocker(snapshot, source);
    if (blocker) throw new Error(blocker);
    resolveAgentProvider(snapshot, input.selection.provider);
    const sourceRef = conversationRefFromAgent(source);
    if (!sourceRef) throw new Error('Source conversation is unavailable.');
    const handoff: AgentHandoff = { ...input, sourceAgentId: sourceId, sourceTitle: source.conversationTitle ?? source.name ?? 'Agent', sourceRef, phase: 'preparing' };
    source.handoff = handoff;
    try {
      await this.options.assertReady(source);
      await this.options.persist();
      const note = (await this.options.requestNote(source, notePrompt(input))).trim();
      if (!note || note.length > handoffNoteLimit) throw new Error('The handoff note is empty or too long. This conversation is unchanged; try again.');
      // Completion alone is insufficient: an approval, queue or child may have appeared meanwhile.
      this.assertSourceAvailable(source);
      await this.options.assertReady(source);
      handoff.note = note;
      handoff.phase = 'closing';
      await this.options.persist();
      await this.options.checkDelegates?.(source);
      await this.options.retire(source);
      this.assertSourceAvailable(source);
      await this.options.checkDelegates?.(source);
      const target = this.options.create({ name: source.name ?? '', folder: source.folder!, teamId: source.teamId, avatar: source.avatar, ...(source.delegatedByAgentId ? { delegatedByAgentId: source.delegatedByAgentId } : {}), selection: input.selection });
      target.workspace = source.workspace;
      target.pullRequest = source.pullRequest;
      target.handoff = handoff;
      handoff.targetAgentId = target.id;
      handoff.phase = 'starting';
      for (const assignment of Object.values(snapshot.workBacklog.assignments)) {
        if (assignment.agentId === sourceId) assignment.agentId = target.id;
      }
      for (const agent of snapshot.agents) {
        if (agent.delegatedByAgentId === sourceId) agent.delegatedByAgentId = target.id;
      }
      const wasSelected = snapshot.activeAgentId === sourceId;
      closeAgentInSnapshot(snapshot, sourceId);
      if (wasSelected) snapshot.activeAgentId = target.id;
      const team = snapshot.teams.find(team => team.id === target.teamId);
      if (wasSelected && team) team.activeAgentId = target.id;
      await this.options.persist();
      await this.options.replaced?.(source, target);
      await this.options.start(target, `Continue the work from ${handoff.sourceTitle}. The previous agent wrote this handoff note. You share its workspace; inspect the current files and follow the repository instructions.\n\n${note}`);
      handoff.phase = 'complete';
      await this.options.persist();
    } catch (error) {
      if (handoff.targetAgentId) handoff.phase = 'failed';
      else this.abandon(source);
      await this.options.persist().catch(() => undefined);
      throw error;
    }
  }

  private assertSourceAvailable(source: Agent): void {
    if (!this.options.snapshot.agents.includes(source)) throw new Error('Source agent is no longer available.');
    const blocker = agentHandoffBlocker(this.options.snapshot, { ...source, handoff: undefined });
    if (blocker) throw new Error(blocker);
  }
}

function notePrompt(input: AgentHandoffInput): string {
  return [
    `The user is handing this work to a new ${providerDisplayName(input.selection.provider)} agent in the same workspace.`,
    'Write a self-contained handoff note as your final response, under 32,000 characters.',
    'Include the objective, user constraints and decisions, completed changes, verification evidence, relevant files, unfinished work, and the next action.',
    'Distinguish observed results from assumptions. Do not include secrets.',
    `Do not run tools, change files, create agents, or close anything. ${product.name} will create the replacement after this turn finishes.`,
    ...(input.instructions?.trim() ? [`Additional handoff instructions from the user:\n${input.instructions.trim()}`] : []),
  ].join('\n\n');
}
