import { computed, onScopeDispose, ref, watch } from 'vue';
import type { CodexAuthentication, CodexChatGptDeviceCodeLogin, AppApi, RemoteConnection } from '@workspace/core/contracts';
import { appApi } from '../platform-api';

export type RemoteCodexAuthApi = Pick<AppApi,
  'getCodexAuthentication' | 'startCodexChatGptDeviceCodeLogin' | 'cancelCodexChatGptLogin'>;

export function useRemoteCodexAuthentication(connection: () => RemoteConnection, api: () => RemoteCodexAuthApi | undefined = () => appApi) {
  const authentication = ref<CodexAuthentication | null>(null);
  const login = ref<CodexChatGptDeviceCodeLogin | null>(null);
  const busy = ref(false);
  const error = ref('');
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connected = computed(() => Boolean(authentication.value && (authentication.value.account || !authentication.value.requiresOpenaiAuth)));

  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function cancelPending(id: string, pending: CodexChatGptDeviceCodeLogin | null) {
    if (pending) void api()?.cancelCodexChatGptLogin(id, pending.loginId).catch(() => undefined);
  }

  async function refresh(expectedRevision = revision): Promise<void> {
    const client = api();
    if (!client || connection().status !== 'ready') return;
    const id = connection().id;
    try {
      const state = await client.getCodexAuthentication(id);
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
      const pending = await client.startCodexChatGptDeviceCodeLogin(id);
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
      const state = await client.cancelCodexChatGptLogin(connection().id, login.value.loginId);
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
