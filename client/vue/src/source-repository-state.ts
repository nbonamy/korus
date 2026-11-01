import type {
  AppSnapshot,
  CloneSourceRepositoryInput,
  CreateSourceRepositoryInput,
  CreateSourceWorktreeInput,
  SourceBranch,
  SourceRepository,
  SourceWorktree,
} from '@workspace/core/contracts';
import { ref } from 'vue';
import { translate } from './i18n';
import { appApi } from './platform-api';

type CatalogStatus = 'notLoaded' | 'loading' | 'loaded' | 'error';

export function createSourceRepositoryState(options: { getSnapshot: () => AppSnapshot }) {
  const repositories = ref<SourceRepository[]>([]);
  const status = ref<CatalogStatus>('notLoaded');
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    if (!appApi?.listSourceRepositories || !options.getSnapshot().sourceFolder.path) {
      repositories.value = [];
      status.value = 'notLoaded';
      error.value = null;
      return;
    }
    status.value = 'loading';
    error.value = null;
    try {
      repositories.value = await appApi.listSourceRepositories();
      status.value = 'loaded';
    } catch (caught) {
      repositories.value = [];
      status.value = 'error';
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function list(remoteConnectionId?: string): Promise<SourceRepository[]> {
    return appApi?.listSourceRepositories?.(remoteConnectionId) ?? [];
  }

  async function clone(input: CloneSourceRepositoryInput): Promise<SourceRepository> {
    if (!appApi?.cloneSourceRepository) {
      throw new Error(translate('surface.app-state.repositoryCloningIsNotAvailable'));
    }
    const repository = await appApi.cloneSourceRepository(input);
    await load();
    return repository;
  }

  async function create(input: CreateSourceRepositoryInput): Promise<SourceRepository> {
    if (!appApi?.createSourceRepository) {
      throw new Error(translate('surface.app-state.repositoryCreationIsNotAvailable'));
    }
    const repository = await appApi.createSourceRepository(input);
    await load();
    return repository;
  }

  async function createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree> {
    if (!appApi?.createSourceWorktree) {
      throw new Error(translate('surface.app-state.sourceWorktreeCreationIsNotAvailable'));
    }
    const worktree = await appApi.createSourceWorktree(input);
    await load();
    return worktree;
  }

  async function listBranches(repoPath: string, remoteConnectionId?: string): Promise<SourceBranch[]> {
    return appApi?.listSourceBranches?.(repoPath, remoteConnectionId) ?? [];
  }

  async function listWorktrees(repoPath: string, remoteConnectionId?: string): Promise<SourceWorktree[]> {
    return appApi?.listSourceWorktrees?.(repoPath, remoteConnectionId) ?? [];
  }

  return {
    clone,
    create,
    createWorktree,
    error,
    list,
    listBranches,
    listWorktrees,
    load,
    repositories,
    status,
  };
}
