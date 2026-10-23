import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { CreatedAgentResult, SourceBranch, SourceRepository, SourceWorktree, WorkSource } from '@workspace/core/contracts';
import type { CompanionProjectInput, CompanionGitHubRepository } from '@workspace/core/companion-protocol';
import { opaquePath } from '@workspace/core/companion-projection';
import type { CompanionBackendPort } from './manager';
import { resolveRepositorySession } from '../projects/repository-session';
import { acquireRepository } from '../projects/repository-acquisition';

/** Adapts the desktop project workflow without exposing its paths or credentials to the phone. */
export class CompanionProjectAcquisition {
  constructor(private readonly backend: CompanionBackendPort) {}

  private sources(remoteConnectionId?: string) {
    return this.backend.request<WorkSource[]>(backendMethods.workProviderSourcesList, { provider: 'github',
      ...(remoteConnectionId ? { location: { kind: 'remote', remoteConnectionId } } : {}), _clientId: 'companion-read' });
  }

  async list(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]> {
    return (await this.sources(remoteConnectionId)).map(({ id, fullName }) => ({ id, name: fullName }));
  }

  private localSources(remoteConnectionId?: string) {
    return this.backend.request<SourceRepository[]>(backendMethods.sourceRepositoriesList, {
      ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read',
    });
  }

  async localList(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]> {
    return (await this.localSources(remoteConnectionId)).map(({ path, name }) => ({ id: opaquePath(path), name }));
  }

  private async localRepository(repositoryId: string, remoteConnectionId?: string) {
    const repository = (await this.localSources(remoteConnectionId)).find(item => opaquePath(item.path) === repositoryId);
    if (!repository) throw new Error('Repository not found. Refresh the repository list.');
    return repository;
  }

  async localBranches(repositoryId: string, remoteConnectionId?: string) {
    const repository = await this.localRepository(repositoryId, remoteConnectionId);
    return (await this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, {
      repoPath: repository.path, ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read',
    })).map(({ name, isDefault }) => ({ name, isDefault }));
  }

  private sourceBranches(repositoryId: string, remoteConnectionId?: string) {
    return this.backend.request<SourceBranch[]>(backendMethods.workProviderBranchesList, { provider: 'github', sourceId: repositoryId,
      ...(remoteConnectionId ? { location: { kind: 'remote', remoteConnectionId } } : {}), _clientId: 'companion-read' });
  }

  async branches(repositoryId: string, remoteConnectionId?: string) {
    if (!(await this.sources(remoteConnectionId)).some(source => source.id === repositoryId)) throw new Error('Repository not found.');
    return (await this.sourceBranches(repositoryId, remoteConnectionId)).map(({ name, isDefault }) => ({ name, isDefault }));
  }

  async create(input: CompanionProjectInput, remoteConnectionId: string | undefined, authorize: () => Promise<void>): Promise<string> {
    const { teamId, backend } = input;
    let result: CreatedAgentResult;
    if (input.source === 'new') {
      await authorize();
      result = await this.backend.request<CreatedAgentResult>(backendMethods.projectCreate, { input: { name: input.value, teamId, backend }, entityResult: true, _clientId: 'companion-write' });
    } else {
      const remote = remoteConnectionId ? { remoteConnectionId } : {};
      let url = input.value;
      let repository = input.source === 'local' ? await this.localRepository(input.value, remoteConnectionId) : undefined;
      if (input.source === 'github') {
        const selected = (await this.sources(remoteConnectionId)).find(source => source.id === input.value);
        if (!selected) throw new Error('Repository not found. Refresh the GitHub list.');
        url = selected.url;
        if (input.branch || input.worktree) {
          const choices = await this.sourceBranches(selected.id, remoteConnectionId);
          if (input.branch && !choices.some(branch => branch.name === input.branch)) throw new Error('Branch not found. Refresh the branch list.');
          if (input.worktree) {
            if (choices.some(branch => branch.name === input.worktree!.branchName)) throw new Error('That branch already exists.');
            if (!choices.some(branch => branch.name === input.worktree!.baseBranch)) throw new Error('Base branch not found. Refresh the branch list.');
          }
        }
      }
      if (!repository) {
        repository = await acquireRepository(url, true, {
          repositories: () => this.localSources(remoteConnectionId),
          clone: async () => {
            await authorize();
            return this.backend.request<SourceRepository>(backendMethods.sourceRepositoryClone, { input: { url, ...remote }, _clientId: 'companion-write' });
          },
        });
      }
      if (input.source === 'local' && (input.branch || input.worktree)) {
        const choices = await this.localBranches(input.value, remoteConnectionId);
        if (input.branch && !choices.some(branch => branch.name === input.branch)) throw new Error('Branch not found. Refresh the branch list.');
        if (input.worktree && (!choices.some(branch => branch.name === input.worktree!.baseBranch) || choices.some(branch => branch.name === input.worktree!.branchName))) {
          throw new Error('Choose an existing base branch and a new branch name.');
        }
      }
      const folder = input.branch || input.worktree ? await resolveRepositorySession(repository.path, {
        ...(input.branch ? { existingBranch: input.branch, fetchRemoteBranch: input.source !== 'local' } : {}),
        ...(input.worktree ? { worktree: { ...input.worktree, requireNewBranch: true, fetchRemoteBranch: input.source !== 'local' } } : {}),
      }, {
        branches: () => this.backend.request(backendMethods.sourceBranchesList, { repoPath: repository.path, ...remote, _clientId: 'companion-read' }),
        createWorktree: async worktree => {
          await authorize();
          return this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: { ...worktree, ...remote }, _clientId: 'companion-write' });
        },
      }) : repository.path;
      await authorize();
      result = await this.backend.request<CreatedAgentResult>(backendMethods.agentCreate, { input: { name: null, folder, sourceRepositoryName: repository.name, teamId, backend }, entityResult: true, _clientId: 'companion-write' });
    }
    return result.agentId;
  }
}
