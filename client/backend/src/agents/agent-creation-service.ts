import { createAgentInSnapshot } from '@workspace/core/agent-manager';
import type { Agent, AppSnapshot, CreateAgentInput } from '@workspace/core/contracts';
import { createEntityId } from '@workspace/core/ids';
import { resolveAgentProvider } from '@workspace/core/agent-providers';

export type AgentCreationOptions = {
  id?: string;
  select?: boolean;
  afterAgentId?: string;
};

export class AgentCreationService {
  constructor(private readonly snapshot: AppSnapshot, private readonly initializationForFolder?: (folder: string) => Agent['worktreeInitialization']) {}

  create(input: CreateAgentInput, options: AgentCreationOptions = {}): Agent {
    const provider = resolveAgentProvider(this.snapshot, input.selection?.provider);
    const id = options.id ?? createEntityId('agent');
    if (this.snapshot.agents.some(agent => agent.id === id)) throw new Error('Agent already exists.');
    createAgentInSnapshot(this.snapshot, { ...input, selection: { ...input.selection, provider: provider } }, undefined, id, options);
    const agent = this.snapshot.agents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error('Agent could not be created.');
    if (agent.folder) {
      const initialization = this.initializationForFolder?.(agent.folder);
      if (initialization) agent.worktreeInitialization = initialization;
    }
    return agent;
  }
}
