<template>
  <div class="remote-engine-connections">
    <template v-for="engine in engines" :key="engine.backend">
      <SettingsEngineConnectionRow compact :backend="engine.backend" :installed="engine.installed" :title="backendDisplayName(engine.backend)" :authentication="engine.authentication" :connected="engine.connected" :enabled="engine.enabled" :busy="busy" :set-enabled="enabled => setEnabled(engine.backend, enabled)" @refresh="refreshProvider(engine.backend)" @install="installProvider(engine.backend)" @connect="connect(engine)" @disconnect="disconnect(engine.backend)" />
      <RemoteCodexAuthentication v-if="signingIn === engine.backend && engine.backend === 'codex'" :connection="connection" @connected="finishConnection" />
      <ProviderUpdateRow v-if="engine.installed && engine.backend !== 'antigravity'" :backend="engine.backend" :remote-connection-id="connection.id" />
      <RemoteClaudeAuthentication v-if="signingIn === engine.backend && engine.backend === 'claude'" :connection="connection" @connected="finishConnection" />
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" class="app-button app-button--tertiary" type="button" :disabled="busy" @click="refresh">{{ $t('surface.remoteClaudeAuth.retry') }}</button>
    <span v-else-if="busy">{{ $t('auth.checking') }}</span>
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';
import type { AgentBackend, RemoteConnection } from '@workspace/core/contracts';
import type { ProviderConnection } from '@workspace/core/contracts/provider-setup';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import RemoteCodexAuthentication from './RemoteCodexAuthentication.vue';
import RemoteClaudeAuthentication from './RemoteClaudeAuthentication.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';

const props = defineProps<{ connection: RemoteConnection }>();
const engines = ref<ProviderConnection[]>([]);
const signingIn = ref<AgentBackend | null>(null);
const error = ref('');
const busy = ref(false);
let revision = 0;
async function refresh() {
  const expected = ++revision;
  busy.value = true;
  error.value = '';
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    const result = await appApi.getProviderConnections(props.connection.id);
    if (expected === revision) engines.value = result;
  } catch (cause) {
    if (expected === revision) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (expected === revision) busy.value = false; }
}
async function installProvider(backend: AgentBackend) {
  await updateProvider(backend, true);
}
async function refreshProvider(backend: AgentBackend) {
  await updateProvider(backend, false);
}
async function updateProvider(backend: AgentBackend, install: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const expected = revision;
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    if (install) await appApi.installProvider(backend, props.connection.id);
    else await appApi.refreshProvider(backend, props.connection.id);
    if (expected === revision) await refresh();
  } catch (cause) {
    if (expected === revision) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (expected === revision) busy.value = false; }
}
async function setEnabled(backend: AgentBackend, enabled: boolean) {
  if (!appApi) throw new Error('Backend connection is unavailable.');
  const expected = revision;
  const result = await appApi.setProviderEnabled(backend, enabled, props.connection.id);
  if (expected === revision) engines.value = result;
}
async function connect(engine: ProviderConnection) {
  if (!engine.connected && engine.backend === 'antigravity') { error.value = translate('antigravity.remoteLogin'); return; }
  if (!engine.connected) { signingIn.value = engine.backend; return; }
  busy.value = true;
  error.value = '';
  const expected = revision;
  try { await setEnabled(engine.backend, true); }
  catch { if (expected === revision) error.value = translate('engineConnection.updateFailed'); }
  finally { if (expected === revision) busy.value = false; }
}
async function disconnect(backend: AgentBackend) {
  busy.value = true;
  error.value = '';
  const expected = revision;
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    await appApi.disconnectProvider(backend, props.connection.id);
    if (expected === revision) { signingIn.value = null; await refresh(); }
  } catch {
    if (expected === revision) error.value = translate('engineConnection.disconnectFailed');
  } finally { if (expected === revision) busy.value = false; }
}
async function finishConnection() { signingIn.value = null; await refresh(); }
watch(() => props.connection.id, () => { engines.value = []; signingIn.value = null; void refresh(); }, { immediate: true });
onScopeDispose(() => { ++revision; });
</script>

<style scoped>
.remote-engine-connections {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
