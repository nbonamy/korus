import type { ExecutionSelectionOverrides } from '@workspace/core/contracts/execution';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentBackend, AgentCreationProgress, BackendDefaults, SourceRepository } from '@workspace/core/contracts';
import { requireRepositoryName } from '../create-source-repository';

export type ProjectCreationInput = {
  name: string;
  teamId: string;
  selection?: ExecutionSelectionOverrides;
  backendDefaults?: BackendDefaults;
  prompt?: string;
};

export type CreatedProject = {
  repository: SourceRepository;
  agent: Agent;
  promptSubmitted: boolean;
};

export class ProjectCreationService {
  constructor(private readonly ports: {
    createRepository(name: string): Promise<SourceRepository>;
    createAgent(input: {
      repository: SourceRepository;
      teamId: string;
      selection?: ExecutionSelectionOverrides;
      backendDefaults?: BackendDefaults;
    }): Promise<Agent>;
    startAgent(agent: Agent, prompt: string): Promise<void>;
  }) {}

  async create(input: ProjectCreationInput, onProgress?: (progress: AgentCreationProgress) => void): Promise<CreatedProject> {
    const name = requireRepositoryName(input.name);
    const progress: AgentCreationProgress = {
      id: `project-creation-${randomUUID()}`,
      state: 'running',
      backend: input.selection?.backend ?? 'codex',
      repositoryName: name,
      createWorktree: false,
      createProject: true,
      hasPrompt: Boolean(input.prompt?.trim()),
      phase: 'creatingProject',
    };
    const emit = (update: Partial<AgentCreationProgress>) => {
      Object.assign(progress, update);
      onProgress?.({ ...progress });
    };
    emit({});
    try {
      const result = await this.createProject({ ...input, name }, phase => emit({ phase }));
      emit({ state: 'success', agentId: result.agent.id, agentName: result.agent.name ?? name });
      return result;
    } catch (error) {
      emit({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async createProject(input: ProjectCreationInput, onPhase: (phase: AgentCreationProgress['phase']) => void): Promise<CreatedProject> {
    const prompt = input.prompt?.trim();
    const repository = await this.ports.createRepository(input.name);
    let agent: Agent;
    try {
      onPhase('creatingAgent');
      agent = await this.ports.createAgent({
        repository,
        teamId: input.teamId,
        ...(input.selection ? { selection: input.selection } : {}),
        ...(input.backendDefaults ? { backendDefaults: input.backendDefaults } : {}),
      });
    } catch (error) {
      throw new Error(`Created the project folder at ${repository.path}, but could not finish setting up its agent. The folder remains on disk; check the agent list before retrying. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (prompt) {
      try {
        onPhase('startingPrompt');
        await this.ports.startAgent(agent, prompt);
      } catch (error) {
        throw new Error(`Created the project at ${repository.path}, but could not start its agent. The project remains available. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    return { repository, agent, promptSubmitted: Boolean(prompt) };
  }
}
