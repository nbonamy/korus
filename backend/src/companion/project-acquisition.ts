import { createHash, randomUUID } from 'node:crypto';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { CreatedAgentResult, SourceBranch, SourceRepository, SourceWorktree, WorkSource } from '@workspace/core/contracts';
import type { CompanionProjectInput, CompanionGitHubRepository, CompanionRepositoryProvider, CompanionRepository } from '@workspace/core/companion-protocol';
import { opaquePath } from '@workspace/core/companion-projection';
import type { CompanionBackendPort } from './manager';
import { resolveRepositorySession } from '../projects/repository-session';
import { acquireRepository } from '../projects/repository-acquisition';

/** Adapts the desktop project workflow without exposing its paths or credentials to the phone. */
export class CompanionProjectAcquisition {
  private readonly selectionSalt = randomUUID();

  constructor(private readonly backend: CompanionBackendPort) {}

  private async request<Result>(method: string, params: unknown, provider?: CompanionRepositoryProvider): Promise<Result> {
    try { return await this.backend.request<Result>(method, params); }
    catch (error) {
      if (provider !== 'gitlab') throw error;
      if (method === backendMethods.workProviderSourcesList) throw new Error('Could not load GitLab repositories on the selected host. Check its GitLab connection and repository access, then refresh.');
      if (method === backendMethods.workProviderBranchesList) throw new Error('Could not load GitLab branches on the selected host. Check its GitLab connection and repository access, then refresh.');
      if (method === backendMethods.sourceRepositoriesList) throw new Error('Could not list existing repositories on the selected host. Check its source folder, then retry.');
      if (method === backendMethods.sourceRepositoryClone) throw new Error('Could not clone the repository on the selected host. Check its Git credentials and repository access, then retry.');
      if (method === backendMethods.sourceWorktreeCreate) throw new Error('Could not prepare the branch on the selected host. Check its Git credentials and repository access, then retry.');
      throw new Error('Could not start work on the selected host. Check its available engines, then retry.');
    }
  }

  private sources(remoteConnectionId?: string, provider: CompanionRepositoryProvider = 'github') {
    return this.request<WorkSource[]>(backendMethods.workProviderSourcesList, { provider,
      ...(remoteConnectionId ? { location: { kind: 'remote', remoteConnectionId } } : {}), _clientId: 'companion-read' }, provider);
  }

  async list(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]> {
    return (await this.sources(remoteConnectionId)).map(({ id, fullName }) => ({ id, name: fullName }));
  }

  private selectionId(source: WorkSource, provider: CompanionRepositoryProvider, remoteConnectionId?: string): string {
    return `repo:${createHash('sha256').update(JSON.stringify([this.selectionSalt, remoteConnectionId ?? null, provider, source.id, source.url])).digest('hex')}`;
  }

  async catalog(provider: CompanionRepositoryProvider, remoteConnectionId?: string): Promise<CompanionRepository[]> {
    return (await this.sources(remoteConnectionId, provider)).map(source => ({ id: this.selectionId(source, provider, remoteConnectionId), name: source.fullName }));
  }

  private async selected(repositoryId: string, provider: CompanionRepositoryProvider, remoteConnectionId?: string): Promise<WorkSource> {
    const source = (await this.sources(remoteConnectionId, provider)).find(source => this.selectionId(source, provider, remoteConnectionId) === repositoryId);
    if (!source) throw new Error('Repository selection expired. Refresh the repository list.');
    return source;
  }

  async catalogBranches(repositoryId: string, provider: CompanionRepositoryProvider, remoteConnectionId?: string) {
    const source = await this.selected(repositoryId, provider, remoteConnectionId);
    return (await this.sourceBranches(source.id, remoteConnectionId, provider)).map(({ name, isDefault }) => ({ name, isDefault }));
  }

  private localSources(remoteConnectionId?: string, provider?: CompanionRepositoryProvider) {
    return this.request<SourceRepository[]>(backendMethods.sourceRepositoriesList, {
      ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read',
    }, provider);
  }

  async localList(remoteConnectionId?: string): Promise<CompanionGitHubRepository[]> {
    return (await this.localSources(remoteConnectionId)).map(({ path, name }) => ({ id: opaquePath(path, remoteConnectionId), name }));
  }

  private async localRepository(repositoryId: string, remoteConnectionId?: string) {
    const repository = (await this.localSources(remoteConnectionId)).find(item => opaquePath(item.path, remoteConnectionId) === repositoryId);
    if (!repository) throw new Error('Repository not found. Refresh the repository list.');
    return repository;
  }

  async localBranches(repositoryId: string, remoteConnectionId?: string) {
    const repository = await this.localRepository(repositoryId, remoteConnectionId);
    return (await this.backend.request<SourceBranch[]>(backendMethods.sourceBranchesList, {
      repoPath: repository.path, ...(remoteConnectionId ? { remoteConnectionId } : {}), _clientId: 'companion-read',
    })).map(({ name, isDefault }) => ({ name, isDefault }));
  }

  private sourceBranches(repositoryId: string, remoteConnectionId?: string, provider: CompanionRepositoryProvider = 'github') {
    return this.request<SourceBranch[]>(backendMethods.workProviderBranchesList, { provider, sourceId: repositoryId,
      ...(remoteConnectionId ? { location: { kind: 'remote', remoteConnectionId } } : {}), _clientId: 'companion-read' }, provider);
  }

  async branches(repositoryId: string, remoteConnectionId?: string) {
    if (!(await this.sources(remoteConnectionId)).some(source => source.id === repositoryId)) throw new Error('Repository not found.');
    return (await this.sourceBranches(repositoryId, remoteConnectionId)).map(({ name, isDefault }) => ({ name, isDefault }));
  }

  async create(input: CompanionProjectInput, remoteConnectionId: string | undefined, authorize: () => Promise<void>): Promise<string> {
    const { teamId, selection } = input;
    const request = <Result>(method: string, params: unknown) => this.request<Result>(method, params, input.source === 'gitlab' ? 'gitlab' : undefined);
    let result: CreatedAgentResult;
    if (input.source === 'new') {
      await authorize();
      result = await request<CreatedAgentResult>(backendMethods.projectCreate, { input: { name: input.value, teamId, selection: { ...selection } }, entityResult: true, _clientId: 'companion-write' });
    } else {
      const remote = remoteConnectionId ? { remoteConnectionId } : {};
      let url = input.value;
      let repository = input.source === 'local' ? await this.localRepository(input.value, remoteConnectionId) : undefined;
      if (input.source === 'github' || input.source === 'gitlab') {
        const selected = input.source === 'gitlab' || input.value.startsWith('repo:')
          ? await this.selected(input.value, input.source, remoteConnectionId)
          : (await this.sources(remoteConnectionId)).find(source => source.id === input.value);
        if (!selected) throw new Error('Repository not found. Refresh the GitHub list.');
        url = selected.url;
        if (input.branch || input.worktree) {
          const choices = await this.sourceBranches(selected.id, remoteConnectionId, input.source);
          if (input.branch && !choices.some(branch => branch.name === input.branch)) throw new Error('Branch not found. Refresh the branch list.');
          if (input.worktree) {
            if (choices.some(branch => branch.name === input.worktree!.branchName)) throw new Error('That branch already exists.');
            if (!choices.some(branch => branch.name === input.worktree!.baseBranch)) throw new Error('Base branch not found. Refresh the branch list.');
          }
        }
      }
      if (!repository) {
        repository = await acquireRepository(url, true, {
          repositories: () => this.localSources(remoteConnectionId, input.source === 'gitlab' ? 'gitlab' : undefined),
          clone: async () => {
            await authorize();
            return request<SourceRepository>(backendMethods.sourceRepositoryClone, { input: { url, ...remote }, _clientId: 'companion-write' });
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
        branches: () => request(backendMethods.sourceBranchesList, { repoPath: repository.path, ...remote, _clientId: 'companion-read' }),
        createWorktree: async worktree => {
          await authorize();
          return request<SourceWorktree>(backendMethods.sourceWorktreeCreate, { input: { ...worktree, ...remote }, _clientId: 'companion-write' });
        },
      }) : repository.path;
      await authorize();
      result = await request<CreatedAgentResult>(backendMethods.agentCreate, { input: { name: null, folder, sourceRepositoryName: repository.name, teamId, selection: { ...selection } }, entityResult: true, _clientId: 'companion-write' });
    }
    return result.agentId;
  }
}
