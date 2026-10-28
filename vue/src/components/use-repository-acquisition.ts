import type {
  CloneSourceRepositoryInput,
  SourceRepository,
  WorkIntegrationConnection,
  WorkSource,
  AutomationLocation,
} from '@workspace/core/contracts';
import { computed, ref, watch } from 'vue';

export type RepositoryProvider = 'github' | 'gitlab';
export type RepositoryAcquisitionMode = RepositoryProvider | 'url';

export type RepositoryAcquisitionOptions = {
  activeTeamId: () => string | undefined;
  catalog: (provider: RepositoryProvider) => WorkSource[] | undefined;
  chooseLocalFolder: () => Promise<string | null>;
  cloneRepository: (input: CloneSourceRepositoryInput) => Promise<SourceRepository>;
  connectProvider: (provider: RepositoryProvider) => Promise<void>;
  errorMessage: (error: unknown) => string;
  connection: (provider: RepositoryProvider) => WorkIntegrationConnection;
  connectionError: (provider: RepositoryProvider) => string | null;
  loadRepositories: (provider: RepositoryProvider) => Promise<WorkSource[] | void>;
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

  let revision = 0;
  const awaitingCatalog = ref(false);
  const provider = computed<RepositoryProvider>(() => mode.value === 'gitlab' ? 'gitlab' : 'github');
  const connection = computed<WorkIntegrationConnection>(() => options.connection(provider.value));
  const displayError = computed(() => error.value ?? (mode.value !== 'url' ? options.connectionError(provider.value) : null));
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
      loadSourceRepositories(mine);
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
    try {
      const items = await options.loadRepositories(selectedProvider);
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
      const repository = await options.cloneRepository({
        url,
        ...(reuseExisting ? { reuseExisting: true } : {}),
      });
      if (mine !== revision) return;
      close();
      await options.openRepository(repository, options.activeTeamId(), source);
    });
  }

  async function openExistingFolder(): Promise<void> {
    const folder = await options.chooseLocalFolder();
    if (folder) await options.openFolder(folder, options.activeTeamId());
  }

  function loadSourceRepositories(mine: number): void {
    if (mine === revision) sourceRepositories.value = options.sourceRepositories();
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
    if (visible.value) sourceRepositories.value = next;
  });
  watch(() => options.catalog(provider.value), next => {
    if (visible.value && mode.value !== 'url' && connection.value.status === 'connected' && next) {
      repositories.value = next.filter(item => item.provider === provider.value);
    }
  });
  watch(() => [mode.value, connection.value.status] as const, ([nextMode, status], [previousMode, previous]) => {
    if (!visible.value || nextMode === 'url' || previousMode !== nextMode) return;
    if (status === 'connected' && previous !== 'connected') void loadCatalog();
    else if (status !== 'connected' && previous === 'connected') { ++revision; repositories.value = []; loading.value = false; busy.value = false; }
  });
  watch(() => options.activeTeamId(), () => {
    if (visible.value) void open(mode.value);
  });

  return {
    busy,
    connection,
    catalogLoading,
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
    select,
    sourceRepositories,
  };
}
