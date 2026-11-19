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
          :error="engineRowError(engine)"
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
      <RemoteTerminalAuthentication
        v-else-if="signingIn === engine.provider"
        :connection="connection"
        :provider="engine.provider"
        :commands="terminalSignInCommands(engine)"
        :hint="engine.provider === 'cursor' ? translate('surface.remoteTerminalAuth.cursorHint') : engine.provider === 'antigravity' ? translate('surface.remoteTerminalAuth.antigravityHint') : undefined"
        :issue="terminalSignInIssue(engine)"
        @checked="engine.authentication = $event"
        @connected="finishConnection"
        @cancel="signingIn = null"
        @activity="authActivity = $event"
      />
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" class="app-button app-button--tertiary agent-ui-interactive" type="button" :disabled="busy" @click="refresh">{{ $t('surface.remoteClaudeAuth.retry') }}</button>
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
import RemoteTerminalAuthentication from './RemoteTerminalAuthentication.vue';
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
  error.value = '';
  if (!engine.connected) { signingIn.value = engine.provider; return; }
  busy.value = true;
  const expected = revision;
  try { await setEnabled(engine.provider, true); }
  catch { if (expected === revision) error.value = translate('engineConnection.updateFailed'); }
  finally { if (expected === revision) busy.value = false; }
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function engineRowError(engine: ProviderConnection): string | undefined {
  if (engine.authentication?.kind === 'cursor' && engine.authentication.state.error) return engine.authentication.state.error;
  if (engine.installed && !engine.connected && engine.error) return translate('surface.remoteTerminalAuth.unverified');
  return engine.error;
}

function antigravitySignInHome(engine: ProviderConnection): string | undefined {
  return (engine.authentication?.kind === 'antigravity' ? engine.authentication.state.homePath : undefined)
    || providerSetup.value.find(setup => setup.provider === engine.provider)?.homePath;
}

function terminalSignInIssue(engine: ProviderConnection): string | undefined {
  if (engine.provider === 'antigravity' && !antigravitySignInHome(engine)) return translate('surface.remoteTerminalAuth.homeUnavailable');
  if (engine.authentication?.kind === 'cursor' && engine.authentication.state.supported === false) return engine.authentication.state.error;
  return undefined;
}

function terminalSignInCommands(engine: ProviderConnection) {
  if (engine.provider !== 'claude') {
    const home = engine.provider === 'antigravity' ? antigravitySignInHome(engine) : undefined;
    if (engine.provider === 'antigravity' && !home) return [];
    const command = home ? `agy acp --login --gemini-dir ${quoteShellArgument(home)}` : 'NO_OPEN_BROWSER=1 agent login';
    return [{
      label: translate('surface.remoteTerminalAuth.command'),
      command: `PATH="$HOME/.local/bin:$PATH" ${command}`,
      copyLabel: translate('surface.remoteTerminalAuth.copy'),
      copiedLabel: translate('surface.remoteTerminalAuth.copied'),
    }];
  }
  const state = engine.authentication?.kind === 'claude' ? engine.authentication.state : undefined;
  const env = state?.configDirectory ? `CLAUDE_CONFIG_DIR=${quoteShellArgument(state.configDirectory)}` : 'env -u CLAUDE_CONFIG_DIR';
  const executable = state?.executablePath ? quoteShellArgument(state.executablePath) : 'claude';
  return [
    { label: translate('surface.remoteClaudeAuth.subscriptionLabel'), command: `${env} ${executable} auth login --claudeai`,
      copyLabel: translate('surface.remoteClaudeAuth.copySubscription'), copiedLabel: translate('surface.remoteClaudeAuth.copiedSubscription') },
    { label: translate('surface.remoteClaudeAuth.consoleLabel'), command: `${env} ${executable} auth login --console`,
      copyLabel: translate('surface.remoteClaudeAuth.copyConsole'), copiedLabel: translate('surface.remoteClaudeAuth.copiedConsole') },
  ];
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
