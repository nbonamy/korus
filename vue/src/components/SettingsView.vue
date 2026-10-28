<template>
  <section
    class="settings-view"
    :aria-label="$t('surface.settingsView.settings')"
  >
    <div class="settings-view__header" />
    
    <SettingsSidebar
      :active-tab="activeTab"
      :available-backends="providerConnections?.map(provider => provider.backend) ?? []"
      class="settings-view__sidebar"
      @select="selectTab"
    />

    <main class="settings-view__content">
      <div class="settings-view__panel" :class="{ 'settings-view__panel--wide': activeTab === 'usage' }">
        <UsagePanel v-if="activeTab === 'usage'" />
        <SettingsBrowserPanel v-else-if="activeTab === 'browser' && appHostCapabilities.embeddedBrowser" />
        <SettingsGeneralPanel
          v-else-if="activeTab === 'general'"
          :choose-source-folder="chooseSourceFolder"
          :daemon-status="daemonStatus"
          :daemon-status-error="daemonStatusError"
          :settings="generalSettings"
          :source-folder="sourceFolder"
          :set-daemon-enabled="setDaemonEnabled"
          :restart-app="restartApp"
          :update-settings="updateSettings"
        />
        <SettingsWorkflowsPanel v-else-if="activeTab === 'workflows'" :settings="generalSettings" :update-settings="updateSettings" />
        <SettingsVoicePanel
          v-else-if="activeTab === 'voice'"
          :settings="generalSettings"
          :update-settings="updateSettings"
        />
        <SettingsInstructionsPanel
          v-else-if="activeTab === 'git'"
          :settings="generalSettings"
          :update-settings="updateSettings"
        />
        <SettingsPersonalizationPanel v-else-if="activeTab === 'personalization'" />
        <SettingsCodexPanel
          v-else-if="activeTab === 'codex'"
          :connected="codexConnected"
          :remote-connection-id="remoteConnectionId"
          :installed="providerConnections?.find(engine => engine.backend === 'codex')?.installed ?? false"
          @refresh="refreshProvider?.('codex')"
          :authentication="providerConnections?.find(engine => engine.backend === 'codex')?.authentication"
          @customize="customizeProvider?.('codex')"
          :set-enabled="enabled => setProviderEnabled?.('codex', enabled)"
          :connection-busy="codexConnectionBusy || updatingProvider === 'codex'"
          :login-pending="codexLoginPending"
          :connection-error="codexConnectionError || providerSetupError"
          @connect="connectCodex"
          @disconnect="disconnectProvider?.('codex')"
          @cancel="cancelCodexLogin"
          :launch-chat-gpt-app="launchChatGptApp"
          :settings="generalSettings"
        />
        <SettingsAntigravityPanel
          v-else-if="activeTab === 'antigravity'"
          :installed="providerConnections?.find(engine => engine.backend === 'antigravity')?.installed ?? false"
          @refresh="refreshProvider?.('antigravity')"
          @install="installProvider?.('antigravity')"
          :connected="providerConnections?.some(engine => engine.backend === 'antigravity' && engine.connected)"
          :authentication="providerConnections?.find(engine => engine.backend === 'antigravity')?.authentication"
          :home="generalSettings.providerHomes?.antigravity"
          :enabled="generalSettings.providerEnabled?.antigravity !== false"
          :set-enabled="enabled => setProviderEnabled?.('antigravity', enabled)"
          :busy="antigravityConnectionBusy || updatingProvider === 'antigravity'"
          :pending="antigravityLoginPending"
          :error="antigravityConnectionError || providerSetupError"
          @customize="customizeProvider?.('antigravity')"
          @connect="connectAntigravity"
          @disconnect="disconnectProvider?.('antigravity')"
          @cancel="cancelAntigravityLogin"
        />
        <SettingsClaudeCodePanel
          v-else-if="activeTab === 'claude-code'"
          :connected="claudeConnected"
          :installed="providerConnections?.find(engine => engine.backend === 'claude')?.installed ?? false"
          @refresh="refreshProvider?.('claude')"
          :authentication="providerConnections?.find(engine => engine.backend === 'claude')?.authentication"
          :home="generalSettings.providerHomes?.claude"
          @customize="customizeProvider?.('claude')"
          :enabled="generalSettings.providerEnabled?.claude !== false"
          :set-enabled="enabled => setProviderEnabled?.('claude', enabled)"
          :busy="claudeConnectionBusy || updatingProvider === 'claude'"
          :error="claudeConnectionError || providerSetupError"
          @connect="connectClaude"
          @disconnect="disconnectProvider?.('claude')"
        />
        <SettingsAppearancePanel
          v-else-if="activeTab === 'appearance'"
          :settings="settings"
          :update-settings="updateSettings"
        />
        <SettingsAppshotsPanel
          v-else-if="activeTab === 'appshots' && appHostCapabilities.appshots"
          :settings="generalSettings.appshots"
          :update-settings="updateSettings"
        />
        <SettingsIntegrationsPanel
          v-else-if="activeTab === 'integrations'"
          :authorization="workProviderAuthorization"
          :authorizations="workProviderAuthorizations"
          :busy-providers="busyIntegrationProviders"
          :connections="workBacklogConnections"
          :error="workBacklogError"
          :provider-settings="workProviderSettings"
          :update-settings="updateSettings"
          @complete="pollWorkProviderAuthorization"
          @connect="provider => runIntegrationAction(provider, connectWorkProvider)"
          @disconnect="provider => runIntegrationAction(provider, disconnectWorkProvider)"
          @open-authorization="openWorkProviderAuthorization"
        />
        <SettingsSkillsPanel v-else-if="activeTab === 'skills'" />
        <SettingsPluginsPanel
          v-else-if="activeTab === 'plugins'"
          :settings="generalSettings?.plugins"
          :update-settings="updateSettings"
          :get-plugin-status="getPluginStatus"
        />
        <SettingsConnectionsPanel
          v-else-if="activeTab === 'connections'"
          :app-version="appVersion"
          :connections="remoteConnections"
          :provider-connections="providerConnections"
          :settings="generalSettings"
          :update-settings="updateSettings"
          :teams="teams"
          :list-source-folders="listSourceFolders"
          :list-ssh-hosts="listSshHosts"
          :add-ssh-connection="addSshConnection"
          :check-remote-connection="checkRemoteConnection"
          :update-remote-connection="updateRemoteConnection"
          :remove-remote-connection="removeRemoteConnection"
          :companion-control="companionControl"
          :get-remote-control-status="getRemoteControlStatus"
          :enable-remote-control="enableRemoteControl"
          :disable-remote-control="disableRemoteControl"
          :start-device-pairing="startDevicePairing"
          :check-device-pairing="checkDevicePairing"
          :list-paired-devices="listPairedDevices"
          :revoke-paired-device="revokePairedDevice"
        />
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AddSshConnectionInput, AppGeneralSettings, AppPluginStatus, AppThemeSettings, DaemonStatus, DevicePairingSession, DevicePairingStatus, PairedDevice, RemoteConnection, SourceFolderListing, SourceFolderListInput, SourceFolderState, SshHostCandidate, Team, UpdateRemoteConnectionInput, UpdateSettingsInput, WorkBacklogState, WorkIntegrationConnection, WorkProviderAuthorization, WorkProviderKind } from '@workspace/core/contracts';
import { defaultGeneralSettings, defaultSourceFolderState } from '@workspace/core/settings';
import UsagePanel from './UsagePanel.vue';
import SettingsBrowserPanel from './SettingsBrowserPanel.vue';
import SettingsAppearancePanel from './SettingsAppearancePanel.vue';
import SettingsAppshotsPanel from './SettingsAppshotsPanel.vue';
import SettingsClaudeCodePanel from './SettingsClaudeCodePanel.vue';
import SettingsAntigravityPanel from './SettingsAntigravityPanel.vue';
import SettingsCodexPanel from './SettingsCodexPanel.vue';
import SettingsConnectionsPanel from './SettingsConnectionsPanel.vue';
import SettingsWorkflowsPanel from './SettingsWorkflowsPanel.vue';
import SettingsGeneralPanel from './SettingsGeneralPanel.vue';
import SettingsInstructionsPanel from './SettingsInstructionsPanel.vue';
import SettingsPersonalizationPanel from './SettingsPersonalizationPanel.vue';
import SettingsIntegrationsPanel from './SettingsIntegrationsPanel.vue';
import SettingsPluginsPanel from './SettingsPluginsPanel.vue';
import SettingsSkillsPanel from './SettingsSkillsPanel.vue';
import SettingsSidebar from './SettingsSidebar.vue';
import SettingsVoicePanel from './SettingsVoicePanel.vue';
import type { SettingsTab } from './settings-tabs';
import type { ProviderConnection } from '@workspace/core/contracts/provider-setup';
import type { AgentBackend } from '@workspace/core/contracts';
import { appHostCapabilities } from '../platform-api';
import appPackage from '../../package.json';

const appVersion = appPackage.version;

const props = withDefaults(defineProps<{
  codexConnected?: boolean;
  remoteConnectionId?: string;
  providerConnections?: ProviderConnection[];
  refreshProvider?: (backend: AgentBackend) => Promise<void>;
  installProvider?: (backend: AgentBackend) => Promise<void>;
  updatingProvider?: AgentBackend | null;
  providerSetupError?: string | null;
  customizeProvider?: (backend: AgentBackend) => unknown;
  setProviderEnabled?: (backend: AgentBackend, enabled: boolean) => unknown;
  disconnectProvider?: (backend: AgentBackend) => Promise<void>;
  claudeConnected?: boolean;
  codexConnectionBusy?: boolean;
  claudeConnectionBusy?: boolean;
  codexLoginPending?: boolean;
  codexConnectionError?: string | null;
  claudeConnectionError?: string | null;
  connectCodex?: () => Promise<void>;
  connectClaude?: () => Promise<void>;
  connectAntigravity?: () => Promise<void>;
  cancelAntigravityLogin?: () => Promise<void>;
  antigravityConnectionBusy?: boolean;
  antigravityLoginPending?: boolean;
  antigravityConnectionError?: string | null;
  cancelCodexLogin?: () => Promise<void>;
  activeTab?: SettingsTab;
  settings: AppThemeSettings;
  generalSettings?: AppGeneralSettings;
  sourceFolder?: SourceFolderState;
  daemonStatus?: DaemonStatus | null;
  daemonStatusError?: string | null;
  chooseSourceFolder?: () => Promise<string | null>;
  launchChatGptApp?: () => Promise<void>;
  workBacklogConnections?: WorkIntegrationConnection[];
  workBacklogError?: string | null;
  workBacklogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  workProviderSettings?: WorkBacklogState['providerSettings'];
  workProviderAuthorization?: WorkProviderAuthorization | null;
  workProviderAuthorizations?: Partial<Record<WorkProviderKind, WorkProviderAuthorization>>;
  remoteConnections?: RemoteConnection[];
  teams?: Team[];
  listSourceFolders?: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  listSshHosts?: () => Promise<SshHostCandidate[]>;
  addSshConnection?: (input: AddSshConnectionInput) => Promise<void>;
  checkRemoteConnection?: (connectionId: string, inspectOnly?: boolean, backends?: AgentBackend[]) => Promise<void>;
  updateRemoteConnection?: (connectionId: string, input: UpdateRemoteConnectionInput) => Promise<void>;
  removeRemoteConnection?: (connectionId: string) => Promise<void>;
  companionControl?: (input: import('@workspace/core/companion-protocol').CompanionControl) => Promise<import('@workspace/core/companion-protocol').CompanionControlResult>;
  getRemoteControlStatus?: () => Promise<DevicePairingStatus>;
  enableRemoteControl?: () => Promise<DevicePairingStatus>;
  disableRemoteControl?: () => Promise<DevicePairingStatus>;
  startDevicePairing?: () => Promise<DevicePairingSession>;
  checkDevicePairing?: (session: DevicePairingSession) => Promise<boolean>;
  listPairedDevices?: (environmentId: string) => Promise<PairedDevice[]>;
  revokePairedDevice?: (environmentId: string, clientId: string) => Promise<void>;
  pollWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  connectWorkProvider?: (provider: WorkProviderKind, options?: import('@workspace/core/contracts').WorkProviderConnectOptions) => Promise<void>;
  disconnectWorkProvider?: (provider: WorkProviderKind) => Promise<void>;
  openWorkProviderAuthorization?: (provider: WorkProviderKind) => Promise<void>;
  setDaemonEnabled?: (enabled: boolean) => Promise<void>;
  restartApp?: () => Promise<void>;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
  getPluginStatus?: () => Promise<AppPluginStatus>;
}>(), {
  activeTab: 'general',
  workBacklogConnections: () => [],
  workBacklogError: null,
  workBacklogStatus: 'notLoaded',
  workProviderSettings: () => ({}),
  workProviderAuthorization: null,
  remoteConnections: () => [],
  teams: () => [],
  listSourceFolders: async () => ({ path: '', parentPath: null, entries: [] }),
  listSshHosts: async () => [],
  addSshConnection: async () => undefined,
  checkRemoteConnection: async () => undefined,
  updateRemoteConnection: async () => undefined,
  removeRemoteConnection: async () => undefined,
  getRemoteControlStatus: async () => ({ status: 'disabled' as const }),
  enableRemoteControl: async () => ({ status: 'disabled' as const }),
  disableRemoteControl: async () => ({ status: 'disabled' as const }),
  startDevicePairing: async () => ({ pairingCode: '', environmentId: '', expiresAt: '' }),
  checkDevicePairing: async () => false,
  listPairedDevices: async () => [],
  revokePairedDevice: async () => undefined,
  generalSettings: () => ({ ...defaultGeneralSettings }),
  sourceFolder: () => ({ ...defaultSourceFolderState }),
  daemonStatus: null,
  daemonStatusError: null,
  chooseSourceFolder: async () => null,
  pollWorkProviderAuthorization: async () => undefined,
  connectWorkProvider: async () => undefined,
  disconnectWorkProvider: async () => undefined,
  openWorkProviderAuthorization: async () => undefined,
  setDaemonEnabled: async () => undefined,
  restartApp: async () => undefined,
});

const emit = defineEmits<{
  selectTab: [tab: SettingsTab];
}>();

const activeTab = computed(() => props.activeTab === 'antigravity' && !props.providerConnections?.some(provider => provider.backend === 'antigravity') ? 'general' : props.activeTab);
const busyIntegrationProviders = ref<WorkProviderKind[]>([]);

async function runIntegrationAction(provider: WorkProviderKind, action: (provider: WorkProviderKind) => Promise<void>): Promise<void> {
  if (busyIntegrationProviders.value.includes(provider)) return;
  busyIntegrationProviders.value = [...busyIntegrationProviders.value, provider];
  try { await action(provider); }
  finally { busyIntegrationProviders.value = busyIntegrationProviders.value.filter(value => value !== provider); }
}

function selectTab(tab: SettingsTab): void {
  emit('selectTab', tab);
}
</script>

<style scoped>
.settings-view {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  overflow: hidden;
  background: var(--color-shell-main);
}

.settings-view__header {
  position: absolute;
  top: 0;
  left: var(--team-rail-width);
  height: var(--workbench-appbar-height);
  width: calc(100% - var(--team-rail-width));
  background: var(--color-shell-main);
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: drag;
}

.settings-view__sidebar {
  min-height: 0;
  user-select: none;
}

.settings-view__content {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--space-32) var(--space-16);
}

.settings-view__panel {
  max-width: 720px;
  margin: 0 auto;
}
.settings-view__panel--wide {
  max-width: 1200px;
}
</style>
