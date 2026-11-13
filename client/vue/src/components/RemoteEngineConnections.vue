<template>
  <div class="remote-engine-connections">
    <template v-for="engine in orderedEngines" :key="engine.provider">
      <ProviderUpdateRow :provider="engine.provider" :enabled="engine.installed && engine.provider !== 'antigravity'" :remote-connection-id="connection.id" v-slot="updates" @activity="updateActivity[engine.provider] = $event">
        <SettingsEngineConnectionRow
          compact installable overflow
          :provider="engine.provider"
          :capabilities="providerSetup.find(setup => setup.provider === engine.provider)?.capabilities"
          :installed="engine.installed"
          :title="providerDisplayName(engine.provider)"
          :authentication="engine.authentication"
          :error="engine.authentication?.kind === 'cursor' ? engine.authentication.state.error || engine.error : engine.error"
          :connected="engine.connected"
          :enabled="engine.enabled"
          :busy="busy"
          :pending="signingIn === engine.provider"
          :version="updates.summary"
          :update-available="updates.upgradeAvailable"
          :update-busy="updates.busy"
          :menu-items="updates.menuItems"
          @refresh="refreshProvider(engine.provider)"
          @install="installProvider(engine.provider)"
          @connect="connect(engine)"
          @disconnect="disconnect(engine.provider)"
          @cancel="signingIn = null"
          @upgrade="updates.upgrade"
          @menu-select="updates.selectMenuItem"
        />
      </ProviderUpdateRow>
      <RemoteCodexAuthentication v-if="signingIn === engine.provider && engine.provider === 'codex'" :connection="connection" @connected="finishConnection" @cancel="signingIn = null" @activity="authActivity = $event" />
      <RemoteClaudeAuthentication v-if="signingIn === engine.provider && engine.provider === 'claude'" :connection="connection" :authentication="engine.authentication?.kind === 'claude' ? engine.authentication.state : undefined" @connected="finishConnection" @cancel="signingIn = null" @activity="authActivity = $event" />
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" class="app-button app-button--tertiary" type="button" :disabled="busy" @click="refresh">{{ $t('surface.remoteClaudeAuth.retry') }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { HarnessProvider, RemoteConnection } from '@workspace/core/contracts';
import { harnessProviders } from '@workspace/core/contracts/shared';
import type { ProviderConnection, ProviderSetupStatus } from '@workspace/core/contracts/provider-setup';
import { providerDisplayName } from '@workspace/core/provider-driver';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import RemoteCodexAuthentication from './RemoteCodexAuthentication.vue';
import RemoteClaudeAuthentication from './RemoteClaudeAuthentication.vue';
import SettingsEngineConnectionRow from './SettingsEngineConnectionRow.vue';
import ProviderUpdateRow from './ProviderUpdateRow.vue';

const props = defineProps<{ connection: RemoteConnection }>();
const emit = defineEmits<{ activity: [active: boolean] }>();
const engines = ref<ProviderConnection[]>([]);
const providerSetup = ref<ProviderSetupStatus[]>([]);
const orderedEngines = computed(() => harnessProviders.flatMap(backend => engines.value.filter(engine => engine.provider === backend)));
const signingIn = ref<HarnessProvider | null>(null);
const error = ref('');
const busy = ref(false);
const authActivity = ref(false);
const updateActivity = ref<Partial<Record<HarnessProvider, boolean>>>({});
watch(() => busy.value || authActivity.value || Object.values(updateActivity.value).some(Boolean), active => emit('activity', active), { immediate: true });
let revision = 0;
async function refresh() {
  const expected = ++revision;
  busy.value = true;
  error.value = '';
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    const [result, setup] = await Promise.all([
      appApi.getProviderConnections(props.connection.id),
      appApi.getProviderSetup(props.connection.id).catch(() => null),
    ]);
    if (expected === revision) { engines.value = result; if (setup !== null) providerSetup.value = setup; }
  } catch (cause) {
    if (expected === revision) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (expected === revision) busy.value = false; }
}
async function installProvider(provider: HarnessProvider) {
  await updateProvider(provider, true);
}
async function refreshProvider(provider: HarnessProvider) {
  await updateProvider(provider, false);
}
async function updateProvider(provider: HarnessProvider, install: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const expected = revision;
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    if (install) await appApi.installProvider(provider, props.connection.id);
    else await appApi.refreshProvider(provider, props.connection.id);
    if (expected === revision) await refresh();
  } catch (cause) {
    if (expected === revision) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { if (expected === revision) busy.value = false; }
}
async function setEnabled(provider: HarnessProvider, enabled: boolean) {
  if (!appApi) throw new Error('Backend connection is unavailable.');
  const expected = revision;
  busy.value = true;
  try {
    const result = await appApi.setProviderEnabled(provider, enabled, props.connection.id);
    if (expected === revision) engines.value = result;
  } finally { if (expected === revision) busy.value = false; }
}
async function connect(engine: ProviderConnection) {
  if (!engine.connected && engine.provider === 'cursor') { error.value = engine.authentication?.kind === 'cursor' && engine.authentication.state.error || translate('cursor.remoteLogin'); return; }
  if (!engine.connected && engine.provider === 'antigravity') { error.value = translate('antigravity.remoteLogin'); return; }
  if (!engine.connected) { signingIn.value = engine.provider; return; }
  busy.value = true;
  error.value = '';
  const expected = revision;
  try { await setEnabled(engine.provider, true); }
  catch { if (expected === revision) error.value = translate('engineConnection.updateFailed'); }
  finally { if (expected === revision) busy.value = false; }
}
async function disconnect(provider: HarnessProvider) {
  busy.value = true;
  error.value = '';
  const expected = revision;
  try {
    if (!appApi) throw new Error('Backend connection is unavailable.');
    await appApi.disconnectProvider(provider, props.connection.id);
    if (expected === revision) { signingIn.value = null; await refresh(); }
  } catch {
    if (expected === revision) error.value = translate('engineConnection.disconnectFailed');
  } finally { if (expected === revision) busy.value = false; }
}
async function finishConnection() {
  const backend = signingIn.value;
  try {
    if (backend && engines.value.find(engine => engine.provider === backend)?.enabled === false) await setEnabled(backend, true);
    signingIn.value = null;
    await refresh();
  } catch {
    signingIn.value = null;
    error.value = translate('engineConnection.updateFailed');
  }
}
watch(() => props.connection.id, () => { engines.value = []; providerSetup.value = []; signingIn.value = null; void refresh(); }, { immediate: true });
onScopeDispose(() => { ++revision; emit('activity', false); });
</script>

<style scoped>
.remote-engine-connections {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

</style>
