import type { HarnessProvider, ClaudeAuthentication, CodexAuthentication, AppApi } from '@workspace/core/contracts';
import { providerAuthenticationState, type ProviderAuthenticationAction, type ProviderConnection, type ProviderSetupChange, type ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { providerDisplayName } from '@workspace/core/provider-driver';
import { translate } from '../i18n';
import { localizedErrorMessage } from '../i18n/errors';
import { clearFirstRunOnboardingStage, getFirstRunOnboardingStage, setFirstRunOnboardingStage } from '../onboarding-session';

/** What each provider's connection control shows while it signs in, keyed by provider. */
export type ProviderConnectionActivity = Partial<Record<HarnessProvider, { busy: boolean; error: string | null | undefined }>>;

type FirstRunOnboardingOptions = {
  getApi: () => AppApi | undefined;
  getConnections: () => ProviderConnection[];
  hasExistingWorkspace: () => boolean;
};

export function useFirstRunOnboarding(options: FirstRunOnboardingOptions) {
  const authentication = ref<CodexAuthentication | null>(null);
  watch(() => JSON.stringify(options.getConnections().find(provider => provider.provider === 'codex')?.authentication), () => {
    const cached = options.getConnections().find(provider => provider.provider === 'codex')?.authentication;
    if (cached?.kind === 'codex') authentication.value = cached.state;
  }, { immediate: true });
  const authenticationLoading = ref(!options.hasExistingWorkspace());
  const authenticationCancelling = ref(false);
  const authenticationError = ref<string | null>(null);
  const claudeAuthentication = ref<ClaudeAuthentication | null>(null);
  const claudeLoading = ref(false);
  const claudeError = ref<string | null>(null);
  const claudeDialogVisible = ref(false);
  const cursorLoading = ref(false);
  const cursorPending = ref(false);
  const cursorError = ref<string | null>(null);
  const antigravityLoading = ref(false);
  const antigravityPending = ref(false);
  const antigravityError = ref<string | null>(null);
  const providersVisible = ref(false);
  const continuing = ref(false);
  const repositoriesVisible = ref(false);
  const completeVisible = ref(false);
  const discovering = ref(!options.hasExistingWorkspace());
  const providerSetup = ref<ProviderSetupStatus[]>([]);
  const customizingProvider = ref<HarnessProvider | null>(null);
  const updatingProvider = ref<HarnessProvider | null>(null);
  const setupBusy = computed(() => updatingProvider.value !== null);
  const setupError = ref<string | null>(null);
  const customizedSetup = computed(() => providerSetup.value.find(setup => setup.provider === customizingProvider.value) ?? null);
  let disposed = false;
  let authenticationPoll: ReturnType<typeof setTimeout> | null = null;
  let pollRevision = 0;

  const codexConnected = computed(() => options.getConnections().some(provider => provider.provider === 'codex' && provider.connected));
  const claudeConnected = computed(() => options.getConnections().some(provider => provider.provider === 'claude' && provider.connected));
  const cursorConnected = computed(() => options.getConnections().some(provider => provider.provider === 'cursor' && provider.connected));
  const antigravityConnected = computed(() => options.getConnections().some(provider => provider.provider === 'antigravity' && provider.connected));
  const connection = (provider: HarnessProvider) => options.getConnections().find(candidate => candidate.provider === provider);
  const checking = (provider: HarnessProvider) => connection(provider)?.checking === true;
  const cursorConnectionError = computed(() => {
    const authentication = connection('cursor')?.authentication;
    return cursorError.value ?? (authentication?.kind === 'cursor' ? authentication.state.error : undefined) ?? connection('cursor')?.error;
  });
  const connectionActivity = computed<ProviderConnectionActivity>(() => ({
    codex: { busy: authenticationLoading.value || checking('codex'), error: authenticationError.value ?? authentication.value?.login.error ?? connection('codex')?.error },
    claude: { busy: claudeLoading.value || checking('claude'), error: claudeError.value ?? connection('claude')?.error },
    cursor: { busy: cursorLoading.value || checking('cursor'), error: cursorConnectionError.value },
    antigravity: { busy: antigravityLoading.value || checking('antigravity'), error: antigravityError.value ?? connection('antigravity')?.error },
  }));
  const canContinue = computed(() => options.getConnections().some(provider => provider.connected && provider.installed && provider.enabled !== false));
  const initialAuthenticationLoading = computed(() => discovering.value);
  const showLogin = computed(() => discovering.value || providersVisible.value);
  const gated = computed(() => showLogin.value || repositoriesVisible.value || completeVisible.value);

  async function load(): Promise<void> {
    if (!options.getApi()) {
      discovering.value = false;
      authenticationLoading.value = false;
      return;
    }
    try { providerSetup.value = await requireApi().getProviderSetup(); }
    catch (error) { setupError.value = errorMessage(error); }
    await refreshConnections();
    if (disposed) return;
    discovering.value = false;
    authenticationLoading.value = false;
    if (!canContinue.value || getFirstRunOnboardingStage() === 'providers'
      || (!getFirstRunOnboardingStage() && !options.hasExistingWorkspace())) {
      providersVisible.value = true;
      setFirstRunOnboardingStage('providers');
    } else {
      restore();
    }
    if (authentication.value?.login.status === 'pending') startPolling();
  }

  async function refreshCodex(): Promise<void> {
    try {
      const next = await codexAuthentication('check');
      if (!disposed) authentication.value = next;
    } catch (error) {
      if (!disposed) authenticationError.value = errorMessage(error);
    }
  }

  async function refreshConnections(): Promise<void> {
    try { await requireApi().getProviderConnections(); }
    catch (error) { if (!disposed) setupError.value = errorMessage(error); }
  }

  async function startChatGptLogin(): Promise<void> {
    if (!isInstalled('codex')) return;
    if (codexConnected.value) { await enableConnectedEngine('codex'); return; }
    authenticationLoading.value = true;
    authenticationError.value = null;
    try {
      await requireApi().authenticateProvider('codex', 'login', { method: 'browser' });
      if (disposed) return;
      authentication.value = { account: null, requiresOpenaiAuth: true, login: { status: 'pending', error: null } };
      startPolling();
    } catch (error) {
      if (!disposed) authenticationError.value = errorMessage(error);
    } finally {
      if (!disposed) authenticationLoading.value = false;
    }
  }

  async function refreshClaude(): Promise<void> {
    claudeLoading.value = true;
    claudeError.value = null;
    try {
      const connecting = claudeDialogVisible.value;
      const next = providerAuthenticationState(await requireApi().authenticateProvider('claude', 'check'), 'claude');
      if (disposed) return;
      claudeAuthentication.value = next;
      if (next.loggedIn) claudeDialogVisible.value = false;
      // Claude signs in outside the app: the dialog is the user connecting it, so a check on its own turns nothing on.
      if (next.loggedIn && connecting) await requireApi().setProviderEnabled('claude', true);
    } catch (error) {
      if (!disposed) {
        claudeAuthentication.value = null;
        claudeError.value = errorMessage(error);
      }
    } finally {
      if (!disposed) claudeLoading.value = false;
    }
  }

  async function connectClaude(): Promise<void> {
    if (!isInstalled('claude')) return;
    if (claudeConnected.value) { await enableConnectedEngine('claude'); return; }
    claudeDialogVisible.value = true;
    await refreshClaude();
  }

  async function enableConnectedEngine(provider: HarnessProvider): Promise<void> {
    const busy = provider === 'cursor' ? cursorLoading : provider === 'antigravity' ? antigravityLoading : provider === 'codex' ? authenticationLoading : claudeLoading;
    const error = provider === 'cursor' ? cursorError : provider === 'antigravity' ? antigravityError : provider === 'codex' ? authenticationError : claudeError;
    busy.value = true;
    error.value = null;
    try { await requireApi().setProviderEnabled(provider, true); }
    catch (cause) { if (!disposed) error.value = errorMessage(cause); }
    finally { if (!disposed) busy.value = false; }
  }

  async function disconnectProvider(provider: HarnessProvider): Promise<void> {
    const busy = provider === 'cursor' ? cursorLoading : provider === 'antigravity' ? antigravityLoading : provider === 'codex' ? authenticationLoading : claudeLoading;
    const error = provider === 'cursor' ? cursorError : provider === 'antigravity' ? antigravityError : provider === 'codex' ? authenticationError : claudeError;
    busy.value = true;
    error.value = null;
    try {
      const result = await requireApi().disconnectProvider(provider);
      if (disposed) return;
      if (result.kind === 'codex') {
        stopPolling();
        authentication.value = result.state;
      } else if (result.kind === 'claude') {
        claudeAuthentication.value = result.state;
        claudeDialogVisible.value = false;
      }
    } catch (cause) {
      if (!disposed) error.value = errorMessage(cause);
    } finally { if (!disposed) busy.value = false; }
  }

  function isInstalled(provider: HarnessProvider): boolean {
    return providerSetup.value.some(setup => setup.provider === provider && setup.installed);
  }

  const nativeState = (provider: 'antigravity' | 'cursor') => provider === 'cursor'
    ? { pending: cursorPending, error: cursorError, connected: cursorConnected }
    : { pending: antigravityPending, error: antigravityError, connected: antigravityConnected };

  async function connectNativeProvider(provider: 'antigravity' | 'cursor'): Promise<void> {
    if (!isInstalled(provider)) return;
    const state = nativeState(provider);
    if (state.connected.value) { await enableConnectedEngine(provider); return; }
    state.pending.value = true; state.error.value = null;
    try { await requireApi().authenticateProvider(provider, 'login'); }
    catch (error) { if (!disposed && state.pending.value) state.error.value = errorMessage(error); }
    finally { state.pending.value = false; }
  }
  async function cancelNativeLogin(provider: 'antigravity' | 'cursor'): Promise<void> {
    const state = nativeState(provider);
    state.pending.value = false;
    try { await requireApi().authenticateProvider(provider, 'cancel'); }
    catch (error) { if (!disposed) state.error.value = errorMessage(error); }
  }
  const connectAntigravity = () => connectNativeProvider('antigravity');
  const cancelAntigravityLogin = () => cancelNativeLogin('antigravity');
  const connectCursor = () => connectNativeProvider('cursor');
  const cancelCursorLogin = () => cancelNativeLogin('cursor');

  async function customizeProvider(provider: HarnessProvider): Promise<void> {
    setupError.value = null;
    try { providerSetup.value = await requireApi().getProviderSetup(); }
    catch (error) { setupError.value = errorMessage(error); return; }
    if (disposed) return;
    customizingProvider.value = provider;
  }

  async function installProvider(provider: HarnessProvider): Promise<void> {
    await updateProvider(provider, () => requireApi().installProvider(provider));
  }

  async function refreshProvider(provider: HarnessProvider): Promise<void> {
    if (provider === 'cursor') cursorError.value = null;
    await updateProvider(provider, () => requireApi().refreshProvider(provider));
  }

  async function updateProvider(provider: HarnessProvider, action: () => Promise<ProviderSetupStatus>): Promise<void> {
    if (setupBusy.value) return;
    updatingProvider.value = provider;
    setupError.value = null;
    try {
      const next = await action();
      if (disposed) return;
      providerSetup.value = [...providerSetup.value.filter(setup => setup.provider !== provider), next];
    } catch (error) {
      if (!disposed) setupError.value = errorMessage(error);
    } finally { if (!disposed) updatingProvider.value = null; }
  }

  async function saveProviderSetup(choice: ProviderSetupChange): Promise<void> {
    const backend = customizingProvider.value;
    if (!backend || setupBusy.value) return;
    updatingProvider.value = backend;
    setupError.value = null;
    try {
      if (backend === 'codex') {
        stopPolling();
        if (authentication.value?.login.status === 'pending') await requireApi().authenticateProvider('codex', 'cancel');
      }
      const current = providerSetup.value.find(setup => setup.provider === backend);
      const unchangedLockedSetup = current?.locked && !choice.removeAgentIds
        && current.isolated === choice.isolated && current.shareSkills === choice.shareSkills;
      const next = unchangedLockedSetup ? current : await requireApi().configureProviderSetup(backend, choice);
      if (backend === 'codex') authentication.value = null;
      else if (backend === 'claude') claudeAuthentication.value = null;
      providerSetup.value = providerSetup.value.map(setup => setup.provider === backend ? next : setup);
      customizingProvider.value = null;
      if (!next.installed) return;
      if (backend === 'codex') await refreshCodex();
      else if (backend === 'claude') await refreshClaude();
      else await refreshConnections();
    } catch (error) {
      setupError.value = errorMessage(error);
    } finally { updatingProvider.value = null; }
  }

  async function continueWithProviders(): Promise<void> {
    if (!canContinue.value || continuing.value) return;
    const returningToWorkspace = options.hasExistingWorkspace();
    continuing.value = true;
    authenticationError.value = null;
    try {
      const unsignedSeparateSetups = providerSetup.value.filter(setup => setup.isolated && setup.installed
        && !options.getConnections().some(connection => connection.provider === setup.provider && connection.connected));
      if (unsignedSeparateSetups.length) {
        try {
          await ElMessageBox.confirm(
            translate('auth.separateSignInWarning', {
              providers: unsignedSeparateSetups.map(setup => providerDisplayName(setup.provider)).join(', '),
              count: unsignedSeparateSetups.length,
            }),
            translate('auth.separateSignInTitle'),
            {
              type: 'warning',
              confirmButtonText: translate('auth.reviewSetup'),
              cancelButtonText: translate('auth.continue'),
              confirmButtonClass: 'app-button app-button--primary',
              cancelButtonClass: 'app-button app-button--tertiary',
              distinguishCancelAndClose: true,
              closeOnClickModal: false,
              showClose: false,
            },
          );
          return;
        } catch (action) {
          if (action !== 'cancel') return;
        }
      }
      if (disposed || !canContinue.value) return;
      if (authentication.value?.login.status === 'pending') {
        await cancelChatGptLogin();
        if (authenticationError.value) return;
      }
      await requireApi().updateSettings({ general: { providerOnboardingComplete: true } });
      if (disposed) return;
      stopPolling();
      providersVisible.value = false;
      if (returningToWorkspace) {
        clearFirstRunOnboardingStage();
        repositoriesVisible.value = false;
        completeVisible.value = false;
        return;
      }
      setFirstRunOnboardingStage('repositories');
      restore();
    } catch (error) {
      if (!disposed) authenticationError.value = errorMessage(error);
    } finally {
      if (!disposed) continuing.value = false;
    }
  }

  async function cancelChatGptLogin(): Promise<void> {
    authenticationCancelling.value = true;
    authenticationError.value = null;
    stopPolling();
    try {
      const next = await codexAuthentication('cancel');
      if (!disposed) authentication.value = next;
    } catch (error) {
      if (!disposed) authenticationError.value = errorMessage(error);
    } finally {
      if (!disposed) authenticationCancelling.value = false;
    }
  }

  function completeRepositories(): void {
    repositoriesVisible.value = false;
    completeVisible.value = true;
    setFirstRunOnboardingStage('complete');
  }

  function finish(): void {
    completeVisible.value = false;
    clearFirstRunOnboardingStage();
  }

  function restore(): void {
    const stage = getFirstRunOnboardingStage();
    if (!stage || stage === 'providers') return;
    if (stage === 'complete') {
      completeRepositories();
      return;
    }
    repositoriesVisible.value = true;
    completeVisible.value = false;
  }

  function startPolling(): void {
    stopPolling();
    const revision = pollRevision;
    const poll = async () => {
      try {
        const next = await codexAuthentication('check');
        if (disposed || revision !== pollRevision) return;
        authentication.value = next;
        if (next.account || next.login.status === 'error' || next.login.status === 'cancelled') return;
        authenticationPoll = setTimeout(() => { void poll(); }, 1_000);
      } catch (error) {
        if (!disposed && revision === pollRevision) authenticationError.value = errorMessage(error);
      }
    };
    authenticationPoll = setTimeout(() => { void poll(); }, 1_000);
  }

  function stopPolling(): void {
    ++pollRevision;
    if (authenticationPoll) clearTimeout(authenticationPoll);
    authenticationPoll = null;
  }

  async function codexAuthentication(action: ProviderAuthenticationAction['action']): Promise<CodexAuthentication> {
    return providerAuthenticationState(await requireApi().authenticateProvider('codex', action), 'codex');
  }

  function requireApi(): AppApi {
    const api = options.getApi();
    if (!api) throw new Error(translate('surface.appShell.appAPIIsUnavailable'));
    return api;
  }

  onScopeDispose(() => { if (cursorPending.value) void options.getApi()?.authenticateProvider('cursor', 'cancel').catch(() => {}); disposed = true; stopPolling(); });

  return {
    authentication, authenticationCancelling, authenticationError, authenticationLoading,
    claudeAuthentication, claudeLoading, claudeError, claudeDialogVisible,
    cursorConnected, cursorLoading, cursorPending, cursorError, cursorConnectionError, connectCursor, cancelCursorLogin,
    connectionActivity,
    antigravityConnected, antigravityLoading, antigravityPending, antigravityError, connectAntigravity, cancelAntigravityLogin,
    codexConnected, claudeConnected, canContinue, continuing,
    completeVisible, gated, repositoriesVisible, initialAuthenticationLoading, showLogin,
    cancelChatGptLogin, completeRepositories, finish, load, startChatGptLogin,
    connectClaude, disconnectProvider, refreshClaude, refreshConnections, installProvider, refreshProvider, continueWithProviders,
    providerSetup, customizingProvider, customizedSetup, setupBusy, updatingProvider, setupError, customizeProvider, saveProviderSetup,
  };
}

function errorMessage(error: unknown): string {
  return localizedErrorMessage(error, translate).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
