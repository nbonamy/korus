import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { AppSnapshot, SourceBranch, SourceRepository, SourceWorktree, WorkSource } from '@workspace/core/contracts';
import type { CompanionProjectInput, CompanionGitHubRepository } from '@workspace/core/companion-protocol';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import { opaquePath } from '@workspace/core/companion-projection';
import type { CompanionBackendPort } from './manager';

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
    let result: AppSnapshot;
    if (input.source === 'new') {
      await authorize();
      result = await this.backend.request<AppSnapshot>(backendMethods.projectCreate, { input: { name: input.value, teamId, backend }, _clientId: 'companion-write' });
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
      // Reuse a checkout already in the configured source folder, as desktop does.
      if (!repository) {
        const repositories = await this.localSources(remoteConnectionId);
        const identity = canonicalGitRemoteIdentity(url);
        repository = identity ? repositories.find(candidate => candidate.remoteIdentity === identity) : undefined;
      }
      if (!repository) {
        await authorize();
        repository = await this.backend.request<SourceRepository>(backendMethods.sourceRepositoryClone, { input: { url, ...remote }, _clientId: 'companion-write' });
      }
      if (input.source === 'local' && (input.branch || input.worktree)) {
        const choices = await this.localBranches(input.value, remoteConnectionId);
        if (input.branch && !choices.some(branch => branch.name === input.branch)) throw new Error('Branch not found. Refresh the branch list.');
        if (input.worktree && (!choices.some(branch => branch.name === input.worktree!.baseBranch) || choices.some(branch => branch.name === input.worktree!.branchName))) {
          throw new Error('Choose an existing base branch and a new branch name.');
        }
      }
      let folder = repository.path;
      if (input.worktree) {
        await authorize();
        folder = (await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: {
          repoPath: repository.path, ...input.worktree, requireNewBranch: true, fetchRemoteBranch: input.source !== 'local', ...remote,
        }, _clientId: 'companion-write' })).path;
      } else if (input.branch) {
        const branches = await this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, { repoPath: repository.path, ...remote, _clientId: 'companion-read' });
        const checkedOut = branches.find(branch => branch.name === input.branch)?.worktreePath;
        if (checkedOut) folder = checkedOut;
        else {
          await authorize();
          folder = (await this.backend.request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: {
            repoPath: repository.path, branchName: input.branch, reuseExisting: true, fetchRemoteBranch: input.source !== 'local', ...remote,
          }, _clientId: 'companion-write' })).path;
        }
      }
      await authorize();
      result = await this.backend.request<AppSnapshot>(backendMethods.agentCreate, { input: { name: null, folder, sourceRepositoryName: repository.name, teamId, backend }, _clientId: 'companion-write' });
    }
    const created = result.agents.find(agent => agent.id === result.activeAgentId && agent.teamId === teamId && agent.backend === backend);
    if (!created) throw new Error('The agent was not created.');
    return created.id;
  }
}
