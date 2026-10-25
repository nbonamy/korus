import type {
  CloneSourceRepositoryInput,
  SourceRepository,
  Team,
  WorkIntegrationConnection,
  WorkSource,
  AutomationLocation,
} from '@workspace/core/contracts';
import { computed, ref, watch } from 'vue';

export type RepositoryProvider = 'github' | 'gitlab';
export type RepositoryAcquisitionMode = RepositoryProvider | 'url';

export type RepositoryAcquisitionOptions = {
  activeTeam: () => Team | null;
  activeTeamId: () => string | undefined;
  catalog: (provider: RepositoryProvider) => WorkSource[] | undefined;
  chooseLocalFolder: () => Promise<string | null>;
  cloneRepository: (input: CloneSourceRepositoryInput) => Promise<SourceRepository>;
  connectProvider: (provider: RepositoryProvider) => Promise<void>;
  errorMessage: (error: unknown) => string;
  connection: (provider: RepositoryProvider) => WorkIntegrationConnection;
  connectionError: (provider: RepositoryProvider) => string | null;
  listSourceRepositories: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  loadRepositories: (provider: RepositoryProvider, location?: AutomationLocation) => Promise<WorkSource[] | void>;
  openFolder: (folder: string, teamId?: string) => Promise<void>;
  openAuthorization: (provider: RepositoryProvider) => Promise<void>;
  openRepository: (repository: SourceRepository, teamId?: string, source?: WorkSource) => Promise<void>;
  sourceRepositories: () => SourceRepository[];
};

/** Owns provider-specific and URL repository acquisition dialog workflow. */
export function useRepositoryAcquisition(options: RepositoryAcquisitionOptions) {
  const visible = ref(false);
  const mode = ref<RepositoryAcquisitionMode>('github');
  const repositories = ref<WorkSource[]>([]);
  const sourceRepositories = ref<SourceRepository[]>([]);
  const loading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  const remoteFolderPickerVisible = ref(false);

  let revision = 0;
  const awaitingCatalog = ref(false);
  const provider = computed<RepositoryProvider>(() => mode.value === 'gitlab' ? 'gitlab' : 'github');
  const connection = computed<WorkIntegrationConnection>(() => options.activeTeam()?.remoteConnectionId
    ? { provider: provider.value, status: 'connected' }
    : options.connection(provider.value));
  const displayError = computed(() => error.value ?? (mode.value !== 'url' && !options.activeTeam()?.remoteConnectionId ? options.connectionError(provider.value) : null));
  const catalogLoading = computed(() => loading.value || (awaitingCatalog.value && !error.value && options.catalog(provider.value) === undefined));

  async function open(nextMode: RepositoryAcquisitionMode): Promise<void> {
    const mine = ++revision;
    mode.value = nextMode;
    visible.value = true;
    busy.value = false;
    awaitingCatalog.value = false;
    error.value = null;
    repositories.value = [];
    sourceRepositories.value = [];
    loading.value = nextMode !== 'url';
    if (nextMode !== 'url') {
      await loadSourceRepositories(mine);
      if (mine !== revision) return;
      if (connection.value.status === 'connected') await loadCatalog(mine);
      else loading.value = false;
    }
  }

  function close(): void {
    ++revision;
    loading.value = false;
    visible.value = false;
    busy.value = false;
    awaitingCatalog.value = false;
    error.value = null;
  }

  async function connect(): Promise<void> {
    await runBusy(() => options.connectProvider(provider.value));
  }

  async function openAuthorization(): Promise<void> {
    const mine = revision;
    error.value = null;
    try {
      await options.openAuthorization(provider.value);
    } catch (cause) {
      if (mine === revision) error.value = options.errorMessage(cause);
    }
  }

  async function loadCatalog(mine = revision): Promise<void> {
    loading.value = true;
    const selectedProvider = provider.value;
    const remoteConnectionId = options.activeTeam()?.remoteConnectionId;
    try {
      const items = await options.loadRepositories(selectedProvider, remoteConnectionId ? { kind: 'remote', remoteConnectionId } : undefined);
      if (mine === revision) awaitingCatalog.value = items === undefined;
      if (mine === revision) repositories.value = (items ?? options.catalog(selectedProvider) ?? []).filter(item => item.provider === selectedProvider);
    } catch (cause) {
      if (mine === revision) error.value = options.errorMessage(cause);
    } finally {
      if (mine === revision) loading.value = false;
    }
  }

  async function select(repository: WorkSource): Promise<void> {
    if (repository.provider === provider.value && repositories.value.some(item => item.id === repository.id && item.url === repository.url)) await cloneAndOpen(repository.url, true, repository);
  }

  async function cloneAndOpen(url: string, reuseExisting = false, source?: WorkSource): Promise<void> {
    const mine = revision;
    await runBusy(async () => {
      const team = options.activeTeam();
      const repository = await options.cloneRepository({
        url,
        ...(reuseExisting ? { reuseExisting: true } : {}),
        ...(team?.remoteConnectionId ? { remoteConnectionId: team.remoteConnectionId } : {}),
      });
      if (mine !== revision) return;
      close();
      await options.openRepository(repository, team?.id ?? options.activeTeamId(), source);
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

  async function loadSourceRepositories(mine: number): Promise<void> {
    const remoteConnectionId = options.activeTeam()?.remoteConnectionId?.trim() || undefined;
    try {
      const items = remoteConnectionId
        ? await options.listSourceRepositories(remoteConnectionId)
        : options.sourceRepositories();
      if (mine === revision) sourceRepositories.value = items;
    } catch (cause) {
      if (mine === revision) error.value = options.errorMessage(cause);
    }
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    if (busy.value) return;
    const mine = revision;
    busy.value = true;
    error.value = null;
    try {
      await action();
    } catch (cause) {
      if (mine === revision) error.value = options.errorMessage(cause);
    } finally {
      if (mine === revision) busy.value = false;
    }
  }

  watch(options.sourceRepositories, next => {
    if (visible.value && !options.activeTeam()?.remoteConnectionId) sourceRepositories.value = next;
  });
  watch(() => options.catalog(provider.value), next => {
    if (visible.value && mode.value !== 'url' && connection.value.status === 'connected' && next && !options.activeTeam()?.remoteConnectionId) {
      repositories.value = next.filter(item => item.provider === provider.value);
    }
  });
  watch(() => [mode.value, connection.value.status] as const, ([nextMode, status], [previousMode, previous]) => {
    if (!visible.value || nextMode === 'url' || previousMode !== nextMode) return;
    if (status === 'connected' && previous !== 'connected') void loadCatalog();
    else if (status !== 'connected' && previous === 'connected') { ++revision; repositories.value = []; loading.value = false; busy.value = false; }
  });
  watch([() => options.activeTeam()?.id, () => options.activeTeam()?.remoteConnectionId], () => {
    if (visible.value) void open(mode.value);
  });

  return {
    busy,
    connection,
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
