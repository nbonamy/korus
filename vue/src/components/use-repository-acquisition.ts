import type {
  CloneSourceRepositoryInput,
  SourceRepository,
  Team,
  WorkIntegrationConnection,
  WorkSource,
} from '@workspace/core/contracts';
import { computed, ref, watch } from 'vue';

type CatalogStatus = 'notLoaded' | 'loading' | 'loaded' | 'error';

export type RepositoryAcquisitionOptions = {
  activeTeam: () => Team | null;
  activeTeamId: () => string | undefined;
  catalog: () => WorkSource[] | undefined;
  catalogError: () => string | null;
  catalogStatus: () => CatalogStatus;
  chooseLocalFolder: () => Promise<string | null>;
  cloneRepository: (input: CloneSourceRepositoryInput) => Promise<SourceRepository>;
  connectGitHub: () => Promise<void>;
  errorMessage: (error: unknown) => string;
  githubConnection: () => WorkIntegrationConnection;
  listSourceRepositories: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  loadGitHubRepositories: () => Promise<WorkSource[] | void>;
  openFolder: (folder: string, teamId?: string) => Promise<void>;
  openGitHubAuthorization: () => Promise<void>;
  openRepository: (repository: SourceRepository, teamId?: string) => Promise<void>;
  sourceRepositories: () => SourceRepository[];
};

/** Owns the reusable GitHub/URL repository acquisition dialog workflow. */
export function useRepositoryAcquisition(options: RepositoryAcquisitionOptions) {
  const visible = ref(false);
  const mode = ref<'github' | 'url'>('github');
  const repositories = ref<WorkSource[]>([]);
  const sourceRepositories = ref<SourceRepository[]>([]);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  const remoteFolderPickerVisible = ref(false);

  const displayError = computed(() => (
    error.value ?? (mode.value === 'github' ? options.catalogError() : null)
  ));
  const catalogLoading = computed(() => {
    const status = options.catalogStatus();
    return loading.value || (
      mode.value === 'github' &&
      options.githubConnection().status === 'connected' &&
      status !== 'error' &&
      (status === 'loading' || options.catalog() === undefined)
    );
  });

  async function open(nextMode: 'github' | 'url'): Promise<void> {
    mode.value = nextMode;
    visible.value = true;
    error.value = null;
    repositories.value = [];
    sourceRepositories.value = [];
    if (nextMode === 'github') {
      loading.value = true;
      await loadSourceRepositories();
      if (options.githubConnection().status === 'connected') {
        await loadCatalog();
      } else {
        loading.value = false;
      }
    }
  }

  function close(): void {
    visible.value = false;
    busy.value = false;
    error.value = null;
  }

  async function connect(): Promise<void> {
    await runBusy(options.connectGitHub);
  }

  async function openAuthorization(): Promise<void> {
    error.value = null;
    try {
      await options.openGitHubAuthorization();
    } catch (cause) {
      error.value = options.errorMessage(cause);
    }
  }

  async function loadCatalog(): Promise<void> {
    loading.value = true;
    try {
      repositories.value = await options.loadGitHubRepositories() ?? options.catalog() ?? [];
    } catch (cause) {
      error.value = options.errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  async function select(repository: WorkSource): Promise<void> {
    await cloneAndOpen(repository.url, true);
  }

  async function cloneAndOpen(url: string, reuseExisting = false): Promise<void> {
    await runBusy(async () => {
      const team = options.activeTeam();
      const repository = await options.cloneRepository({
        url,
        ...(reuseExisting ? { reuseExisting: true } : {}),
        ...(team?.remoteConnectionId ? { remoteConnectionId: team.remoteConnectionId } : {}),
      });
      close();
      await options.openRepository(repository, team?.id ?? options.activeTeamId());
    });
  }

  async function openExistingFolder(): Promise<void> {
    const team = options.activeTeam();
    if (team?.remoteConnectionId) {
      remoteFolderPickerVisible.value = true;
      return;
    }

    const folder = await options.chooseLocalFolder();
    if (folder) await openExistingFolderPath(folder);
  }

  function closeRemoteFolderPicker(): void {
    remoteFolderPickerVisible.value = false;
  }

  async function selectRemoteFolder(folder: string): Promise<void> {
    closeRemoteFolderPicker();
    await openExistingFolderPath(folder);
  }

  async function openExistingFolderPath(folder: string): Promise<void> {
    const team = options.activeTeam();
    await options.openFolder(folder, team?.id ?? options.activeTeamId());
  }

  async function loadSourceRepositories(): Promise<void> {
    const remoteConnectionId = options.activeTeam()?.remoteConnectionId?.trim() || undefined;
    try {
      sourceRepositories.value = remoteConnectionId
        ? await options.listSourceRepositories(remoteConnectionId)
        : options.sourceRepositories();
    } catch (cause) {
      error.value = options.errorMessage(cause);
    }
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
      await action();
    } catch (cause) {
      error.value = options.errorMessage(cause);
    } finally {
      busy.value = false;
    }
  }

  function selectedTeamId(): string | undefined {
    return options.activeTeam()?.id ?? options.activeTeamId();
  }

  watch(options.catalog, (next) => {
    if (
      visible.value &&
      mode.value === 'github' &&
      options.githubConnection().status === 'connected' &&
      next
    ) {
      repositories.value = next;
    }
  });

  return {
    busy,
    catalogLoading,
    closeRemoteFolderPicker,
    displayError,
    error,
    mode,
    repositories,
    visible,
    cloneAndOpen,
    close,
    connect,
    open,
    openAuthorization,
    openExistingFolder,
    remoteFolderPickerVisible,
    select,
    selectRemoteFolder,
    sourceRepositories,
  };
}
