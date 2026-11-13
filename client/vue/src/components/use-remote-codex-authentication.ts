import { computed, onScopeDispose, ref, watch } from 'vue';
import type { CodexAuthentication, AppApi, RemoteConnection } from '@workspace/core/contracts';
import { providerAuthenticationState, type AuthenticationLogin } from '@workspace/core/contracts/provider-setup';
import { appApi } from '../platform-api';

export type RemoteCodexAuthApi = Pick<AppApi, 'authenticateProvider'>;
type DeviceCodeLogin = Extract<AuthenticationLogin, { method: 'deviceCode' }>;

export function useRemoteCodexAuthentication(connection: () => RemoteConnection, api: () => RemoteCodexAuthApi | undefined = () => appApi) {
  const authentication = ref<CodexAuthentication | null>(null);
  const login = ref<DeviceCodeLogin | null>(null);
  const busy = ref(false);
  const error = ref('');
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connected = computed(() => Boolean(authentication.value && (authentication.value.account || !authentication.value.requiresOpenaiAuth)));

  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function cancelPending(id: string, pending: DeviceCodeLogin | null) {
    if (pending) void api()?.authenticateProvider('codex', 'cancel', { remoteConnectionId: id, loginId: pending.id }).catch(() => undefined);
  }

  async function refresh(expectedRevision = revision): Promise<void> {
    const client = api();
    if (!client || connection().status !== 'ready') return;
    const id = connection().id;
    try {
      const state = providerAuthenticationState(await client.authenticateProvider('codex', 'check', { remoteConnectionId: id }), 'codex');
      if (expectedRevision !== revision) return;
      authentication.value = state;
      error.value = state.login.error ?? '';
      if (connected.value || state.login.status === 'error' || state.login.status === 'cancelled') login.value = null;
    } catch (cause) {
      if (expectedRevision === revision) {
        if (!login.value) authentication.value = null;
        error.value = String(cause instanceof Error ? cause.message : cause);
      }
    }
    if (expectedRevision === revision && login.value) {
      clearTimer();
      timer = setTimeout(() => { void refresh(expectedRevision); }, 2_000);
    }
  }

  async function start(): Promise<void> {
    const client = api();
    if (!client || busy.value || connection().status !== 'ready') return;
    const expectedRevision = ++revision;
    const id = connection().id;
    clearTimer();
    busy.value = true;
    error.value = '';
    try {
      const { login: pending } = await client.authenticateProvider('codex', 'login', { method: 'deviceCode', remoteConnectionId: id });
      if (pending?.method !== 'deviceCode') throw new Error('Codex did not start a device-code login.');
      if (expectedRevision !== revision) { cancelPending(id, pending); return; }
      login.value = pending;
      await refresh(expectedRevision);
    } catch (cause) {
      if (expectedRevision === revision) error.value = String(cause instanceof Error ? cause.message : cause);
    } finally {
      if (expectedRevision === revision) busy.value = false;
    }
  }

  async function connect(expectedRevision = revision): Promise<void> {
    await refresh(expectedRevision);
    if (expectedRevision === revision && authentication.value && !connected.value) await start();
  }

  async function cancel(): Promise<void> {
    const client = api();
    if (!client || !login.value || busy.value) return;
    const expectedRevision = ++revision;
    clearTimer();
    busy.value = true;
    try {
      const state = providerAuthenticationState(await client.authenticateProvider('codex', 'cancel', { remoteConnectionId: connection().id, loginId: login.value.id }), 'codex');
      if (expectedRevision !== revision) return;
      authentication.value = state;
      login.value = null;
      error.value = state.login.error ?? '';
    } catch (cause) {
      if (expectedRevision === revision) error.value = String(cause instanceof Error ? cause.message : cause);
    } finally {
      if (expectedRevision === revision) busy.value = false;
    }
  }

  watch([() => connection().id, () => connection().status, () => connection().installedAt], (_next, previous) => {
    ++revision;
    clearTimer();
    if (previous?.[0]) cancelPending(previous[0], login.value);
    authentication.value = null;
    login.value = null;
    busy.value = false;
    error.value = '';
    void connect();
  }, { immediate: true });
  onScopeDispose(() => {
    ++revision;
    clearTimer();
    cancelPending(connection().id, login.value);
  });

  return { authentication, login, connected, busy, error, start, cancel, refresh: () => connect() };
}
