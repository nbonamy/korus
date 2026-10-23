<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsConnectionsPanel.connections')"
    title-id="settings-connections-title"
  >
    <template #banner>
      <SettingsIntro kind="connections" :title="$t('surface.settingsConnectionsPanel.introTitle')" :description="$t('surface.settingsConnectionsPanel.introDescription')" />
    </template>

    <FormSection
      :title="$t('surface.settingsConnectionsPanel.remoteAppAgents')"
      title-id="settings-connections-remotes-title"
    >
      <template #actions>
        <el-button
          text
          size="small"
          @click="openAddDialog"
        > {{ $t('surface.settingsConnectionsPanel.addRemote') }} </el-button>
      </template>
      <div
        v-if="connections.length === 0"
        class="settings-connections-panel__empty"
      > {{ $t('surface.settingsConnectionsPanel.noRemoteConnections') }} </div>
      <article
        v-for="connection in connections"
        :key="connection.id"
        class="settings-connections-panel__connection"
      >
        <button
          type="button"
          class="settings-connections-panel__identity"
          :aria-expanded="isExpanded(connection)"
          :aria-controls="`connection-details-${connection.id}`"
          @click="toggleExpanded(connection)"
        >
          <span
            class="settings-connections-panel__dot"
            :class="`settings-connections-panel__dot--${connection.status}`"
            aria-hidden="true"
          />
          <span class="settings-connections-panel__summary">
            <strong>{{ connection.name }}</strong>
            <span>{{ connectionLabel(connection) }}</span>
          </span>
          <AlertTriangleIcon
            v-if="canUpgrade(connection)"
            class="settings-connections-panel__attention"
            role="img"
            :aria-label="$t('surface.settingsConnectionsPanel.upgradeAvailable')"
            :title="$t('surface.settingsConnectionsPanel.upgradeAvailable')"
          />
          <ChevronDown
            class="settings-connections-panel__chevron"
            :class="{ 'settings-connections-panel__chevron--open': isExpanded(connection) }"
            aria-hidden="true"
          />
        </button>
        <div class="settings-connections-panel__actions">
          <button
            type="button"
            :aria-label="$t('dynamic.settings.connection', { connection: connection.name })"
            :title="$t('surface.settingsConnectionsPanel.connectionSettings')"
            @click="openConnectionSettings(connection)"
          >
            <SettingsIcon aria-hidden="true" />
          </button>
          <AppMenuButton
            :ariaLabel="$t('surface.settingsConnectionsPanel.connectionActions')"
            :items="connectionMenuItems(connection)"
            @select="selectConnectionMenuItem(connection, $event)"
          >
            <template #trigger="{ attrs }">
              <button v-bind="attrs" type="button" :aria-label="`${connection.name} actions`">
                <DotsVerticalIcon aria-hidden="true" />
              </button>
            </template>
          </AppMenuButton>
        </div>
        <div
          v-if="isExpanded(connection)"
          :id="`connection-details-${connection.id}`"
          class="settings-connections-panel__details"
        >
          <span
            v-if="connection.detail"
            class="settings-connections-panel__detail"
          >
            <em>{{ connection.detail }}</em>
            <button
              v-if="canUpgrade(connection)"
              class="settings-connections-panel__upgrade"
              type="button"
              :disabled="checkingConnectionId === connection.id"
              @click="checkConnection(connection.id)"
            >{{ $t('surface.settingsConnectionsPanel.upgrade') }}</button>
          </span>
          <RemoteEngineConnections v-if="connection.status === 'ready'" class="settings-connections-panel__engines" :connection="connection" />
        </div>
      </article>
    </FormSection>

    <SettingsMobileSection v-if="companionControl" :control="companionControl" :settings="settings" :update-settings="updateSettings" />

    <SettingsDevicePairingSection
      :settings="settings"
      :update-settings="updateSettings"
      :get-status="getRemoteControlStatus"
      :enable="enableRemoteControl"
      :disable="disableRemoteControl"
      :start="startDevicePairing"
      :check="checkDevicePairing"
      :list-devices="listPairedDevices"
      :revoke-device="revokePairedDevice"
    />

    <FormDialog
      v-model="settingsDialogVisible"
      :title="settingsDialogTitle"
      width="520"
      :teleported="true"
      append-to-body
    >
      <form class="app-form-dialog" @submit.prevent="saveConnectionSettings">
        <FormField
          :label="$t('surface.settingsConnectionsPanel.sourceFolder')"
          label-for="settings-connection-source-folder"
        >
          <div class="app-form-dialog__control app-form-dialog__input-control settings-connections-panel__source-folder-control">
            <input
              id="settings-connection-source-folder"
              v-model="settingsSourceFolderPath"
              class="app-form-dialog__text-input"
              type="text"
              :placeholder="$t('surface.settingsConnectionsPanel.src')"
            />
            <button
              class="app-form-dialog__button-control settings-connections-panel__browse"
              type="button"
              :disabled="!settingsConnection"
              @click="openSettingsFolderPicker"
            > {{ $t('surface.settingsConnectionsPanel.browse') }} </button>
          </div>
        </FormField>
        <p
          v-if="settingsError"
          class="settings-connections-panel__error"
        >
          {{ settingsError }}
        </p>
      </form>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" @click="closeConnectionSettings"> {{ $t('surface.settingsConnectionsPanel.cancel') }} </button>
        <button
          class="app-button app-button--primary"
          type="button"
          :aria-busy="savingConnectionSettings"
          :disabled="savingConnectionSettings"
          @click="saveConnectionSettings"
        > {{ $t('surface.settingsConnectionsPanel.save') }} </button>
      </template>
    </FormDialog>

    <RemoteFolderPickerDialog
      v-if="settingsConnection"
      :initial-path="settingsSourceFolderPath"
      :list-source-folders="listRemoteFolders"
      :remote-connection-id="settingsConnection.id"
      :visible="settingsFolderPickerVisible"
      @close="settingsFolderPickerVisible = false"
      @select="selectSettingsSourceFolder"
    />

    <el-dialog
      v-model="addDialogVisible"
      :title="$t('surface.settingsConnectionsPanel.addSSHConnection')"
      width="680"
      append-to-body
      class="app-dialog"
    >
      <div class="settings-connections-panel__dialog">
        <p
          v-if="hostError"
          class="settings-connections-panel__error"
        >
          {{ hostError }}
        </p>
        <div
          v-else-if="loadingHosts"
          class="settings-connections-panel__loading"
        > {{ $t('surface.settingsConnectionsPanel.loadingSSHHosts') }} </div>
        <div
          v-else-if="sshHosts.length === 0"
          class="settings-connections-panel__empty"
        > {{ $t('surface.settingsConnectionsPanel.noSSHHostsFound') }} </div>
        <div v-else>
          <article
            v-for="host in sshHosts"
            :key="host.host"
            class="settings-connections-panel__host"
          >
            <div>
              <strong>{{ host.host }}</strong>
              <span>{{ hostCandidateLabel(host) }}</span>
            </div>
            <el-button
              size="small"
              :loading="addingHost === host.host"
              :disabled="addingHost !== null"
              @click="addConnection(host)"
            > {{ $t('surface.settingsConnectionsPanel.connect') }} </el-button>
          </article>
        </div>
      </div>
    </el-dialog>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import type { AddSshConnectionInput, DevicePairingSession, DevicePairingStatus, PairedDevice, RemoteConnection, SourceFolderListing, SourceFolderListInput, SshHostCandidate, Team, UpdateRemoteConnectionInput, UpdateSettingsInput } from '@workspace/core/contracts';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { AlertTriangleIcon, ChevronDown, DotsVerticalIcon, RefreshIcon, SettingsIcon, Trash2Icon } from '../shared/icons/app-icons';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import RemoteFolderPickerDialog from './RemoteFolderPickerDialog.vue';
import RemoteEngineConnections from './RemoteEngineConnections.vue';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsMobileSection from './SettingsMobileSection.vue';
import SettingsDevicePairingSection from './SettingsDevicePairingSection.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = withDefaults(defineProps<{
  addSshConnection?: (input: AddSshConnectionInput) => Promise<void>;
  appVersion?: string;
  checkRemoteConnection?: (connectionId: string, inspectOnly?: boolean) => Promise<void>;
  connections?: RemoteConnection[];
  listSourceFolders?: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  listSshHosts?: () => Promise<SshHostCandidate[]>;
  teams?: Team[];
  updateRemoteConnection?: (connectionId: string, input: UpdateRemoteConnectionInput) => Promise<void>;
  removeRemoteConnection?: (connectionId: string) => Promise<void>;
  settings?: { preventSleepWhenRemoteAccessEnabled: boolean };
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
  companionControl?: (input: import('@workspace/core/companion-protocol').CompanionControl) => Promise<import('@workspace/core/companion-protocol').CompanionControlResult>;
  getRemoteControlStatus?: () => Promise<DevicePairingStatus>;
  enableRemoteControl?: () => Promise<DevicePairingStatus>;
  disableRemoteControl?: () => Promise<DevicePairingStatus>;
  startDevicePairing?: () => Promise<DevicePairingSession>;
  checkDevicePairing?: (session: DevicePairingSession) => Promise<boolean>;
  listPairedDevices?: (environmentId: string) => Promise<PairedDevice[]>;
  revokePairedDevice?: (environmentId: string, clientId: string) => Promise<void>;
}>(), {
  addSshConnection: async () => undefined,
  checkRemoteConnection: async () => undefined,
  connections: () => [],
  listSourceFolders: async () => ({ path: '', parentPath: null, entries: [] }),
  listSshHosts: async () => [],
  teams: () => [],
  updateRemoteConnection: async () => undefined,
  removeRemoteConnection: async () => undefined,
  getRemoteControlStatus: async () => ({ status: 'disabled' as const }),
  enableRemoteControl: async () => ({ status: 'disabled' as const }),
  disableRemoteControl: async () => ({ status: 'disabled' as const }),
  startDevicePairing: async () => ({ pairingCode: '', environmentId: '', expiresAt: '' }),
  checkDevicePairing: async () => false,
  listPairedDevices: async () => [],
  revokePairedDevice: async () => undefined,
  settings: () => ({ preventSleepWhenRemoteAccessEnabled: true }),
  updateSettings: async () => undefined,
});

const expandedConnections = ref<Record<string, boolean>>({});
// Healthy connections stay folded; anything that needs attention opens by itself.
function isExpanded(connection: RemoteConnection): boolean {
  return expandedConnections.value[connection.id] ?? connection.status !== 'ready';
}
function toggleExpanded(connection: RemoteConnection): void {
  expandedConnections.value = { ...expandedConnections.value, [connection.id]: !isExpanded(connection) };
}
const addDialogVisible = ref(false);
const settingsDialogVisible = ref(false);
const hosts = ref<SshHostCandidate[]>([]);
const loadingHosts = ref(false);
const hostError = ref<string | null>(null);
const addingHost = ref<string | null>(null);
const checkingConnectionId = ref<string | null>(null);
const settingsConnection = ref<RemoteConnection | null>(null);
const settingsSourceFolderPath = ref('');
const settingsError = ref<string | null>(null);
const savingConnectionSettings = ref(false);
const settingsFolderPickerVisible = ref(false);

const connections = computed(() => props.connections);
const settingsDialogTitle = computed(() => (
  settingsConnection.value ? `${settingsConnection.value.name} settings` : translate('surface.settingsConnectionsPanel.sSHSettings')
));
const sshHosts = computed(() => {
  const connectedHosts = new Set(props.connections.map((connection) => connection.host));
  return hosts.value.filter((host) => !connectedHosts.has(host.host));
});

async function openAddDialog(): Promise<void> {
  addDialogVisible.value = true;
  await loadSshHosts();
}

async function loadSshHosts(): Promise<void> {
  loadingHosts.value = true;
  hostError.value = null;
  try {
    hosts.value = await props.listSshHosts();
  } catch (error) {
    hosts.value = [];
    hostError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loadingHosts.value = false;
  }
}

async function addConnection(host: SshHostCandidate): Promise<void> {
  addingHost.value = host.host;
  hostError.value = null;
  try {
    await props.addSshConnection({
      name: host.host,
      ...host,
    });
    addDialogVisible.value = false;
  } catch (error) {
    hostError.value = error instanceof Error ? error.message : String(error);
  } finally {
    addingHost.value = null;
  }
}

async function checkConnection(connectionId: string): Promise<void> {
  checkingConnectionId.value = connectionId;
  try {
    await props.checkRemoteConnection(connectionId);
  } finally {
    checkingConnectionId.value = null;
  }
}

function openConnectionSettings(connection: RemoteConnection): void {
  settingsConnection.value = connection;
  settingsSourceFolderPath.value = connection.sourceFolderPath ?? '';
  settingsError.value = null;
  settingsDialogVisible.value = true;
}

function closeConnectionSettings(): void {
  if (savingConnectionSettings.value) {
    return;
  }
  settingsDialogVisible.value = false;
  settingsFolderPickerVisible.value = false;
  settingsConnection.value = null;
  settingsError.value = null;
}

async function saveConnectionSettings(): Promise<void> {
  const connection = settingsConnection.value;
  if (!connection) {
    return;
  }

  savingConnectionSettings.value = true;
  settingsError.value = null;
  try {
    await props.updateRemoteConnection(connection.id, {
      sourceFolderPath: settingsSourceFolderPath.value.trim(),
    });
    settingsDialogVisible.value = false;
    settingsFolderPickerVisible.value = false;
    settingsConnection.value = null;
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : String(error);
  } finally {
    savingConnectionSettings.value = false;
  }
}

function openSettingsFolderPicker(): void {
  settingsFolderPickerVisible.value = true;
}

function selectSettingsSourceFolder(path: string): void {
  settingsSourceFolderPath.value = path;
}

function listRemoteFolders(input?: SourceFolderListInput): Promise<SourceFolderListing> {
  return props.listSourceFolders(input);
}

function connectionMenuItems(connection: RemoteConnection): AppMenuItem[] {
  return [{
    id: 'check',
    type: 'action',
    label: checkingConnectionId.value === connection.id ? translate('surface.settingsConnectionsPanel.syncing') : translate('surface.settingsConnectionsPanel.sync'),
    disabled: checkingConnectionId.value === connection.id,
    icon: RefreshIcon,
  }, {
    id: 'delete',
    type: 'action',
    label: translate('surface.settingsConnectionsPanel.delete'),
    danger: true,
    icon: Trash2Icon,
  }];
}

onMounted(async () => {
  // Inspection never installs software or interrupts the remote session.
  for (const connection of props.connections) {
    if (connection.status === 'ready') {
      try { await props.checkRemoteConnection(connection.id, true); } catch { /* Keep the last known status. */ }
    }
  }
});

function canUpgrade(connection: RemoteConnection): boolean {
  const remoteVersion = connectionDaemonVersion(connection);
  return connection.status === 'ready'
    && Boolean(remoteVersion && props.appVersion && remoteVersion !== props.appVersion);
}

function connectionDaemonVersion(connection: RemoteConnection): string | null {
  if (connection.daemonVersion) return connection.daemonVersion;
  return /\bdaemon\s+([^,)]+)/u.exec(connection.detail ?? '')?.[1]?.trim() ?? null;
}

function selectConnectionMenuItem(connection: RemoteConnection, itemId: string): void {
  if (itemId === 'check') {
    void checkConnection(connection.id);
  } else if (itemId === 'delete') {
    void confirmRemoveConnection(connection);
  }
}

async function confirmRemoveConnection(connection: RemoteConnection): Promise<void> {
  const connectedTeams = teamsForConnection(connection.id);
  try {
    await ElMessageBox.confirm(
      connectionDeleteMessage(connection, connectedTeams),
      `Delete ${connection.name}?`,
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('common.delete'),
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  await props.removeRemoteConnection(connection.id);
}

function teamsForConnection(connectionId: string): Team[] {
  return props.teams.filter((team) => team.remoteConnectionId === connectionId);
}

function connectionDeleteMessage(connection: RemoteConnection, teams: Team[]): string {
  if (teams.length === 0) {
    return `${connection.name} will be removed.`;
  }

  const teamNames = teams.map((team) => team.name).join(', ');
  const teamLabel = teams.length === 1 ? 'team' : 'teams';
  return `${connection.name} will be removed. This will also remove ${teams.length} connected ${teamLabel} from this app: ${teamNames}. Remote agents, messages, and automations will keep running on the SSH host.`;
}

function connectionLabel(connection: RemoteConnection): string {
  const target = hostLabel({
    host: connection.host,
    hostName: connection.hostName,
    user: connection.user,
    port: connection.port,
  });
  return `${target} · ${statusLabel(connection.status)}`;
}

function hostCandidateLabel(host: SshHostCandidate): string {
  return hostLabel(host);
}

function hostLabel(host: Pick<SshHostCandidate, 'host' | 'hostName' | 'port' | 'user'>): string {
  const user = host.user ? `${host.user}@` : '';
  const target = host.hostName || host.host;
  const port = host.port ? `:${host.port}` : '';
  return `${user}${target}${port}`;
}

function statusLabel(status: RemoteConnection['status']): string {
  if (status === 'ready') {
    return translate('surface.settingsConnectionsPanel.ready');
  }
  if (status === 'checking') {
    return translate('surface.settingsConnectionsPanel.checking');
  }
  if (status === 'error') {
    return translate('surface.settingsConnectionsPanel.needsAttention');
  }
  return translate('surface.settingsConnectionsPanel.saved');
}
</script>

<style scoped>
.settings-connections-panel__empty,
.settings-connections-panel__loading {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  padding: var(--space-8);
}

.settings-connections-panel__error {
  color: var(--color-error);
  font-size: var(--font-size-13);
  margin: 0;
}

.settings-connections-panel__connection,
.settings-connections-panel__host {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-10);
  border-bottom: 1px solid var(--color-border);
}

.settings-connections-panel__connection {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-6);
  padding: var(--space-6);
}

.settings-connections-panel__details {
  grid-column: 1 / -1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-left: calc(8px + var(--space-8));
  padding-top: var(--space-4);
}

.settings-connections-panel__connection:last-child,
.settings-connections-panel__host:last-child {
  border-bottom: 0;
}

.settings-connections-panel__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-connections-panel__identity:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-md);
}

.settings-connections-panel__attention {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-warning);
}

.settings-connections-panel__chevron {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--color-text-muted);
  transition: transform 120ms ease;
}

.settings-connections-panel__chevron--open {
  transform: rotate(180deg);
}

.settings-connections-panel__summary,
.settings-connections-panel__host > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-connections-panel__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  column-gap: var(--space-6);
}

.settings-connections-panel__identity strong,
.settings-connections-panel__host strong {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: 600;
}

.settings-connections-panel__summary > span,
.settings-connections-panel__host > div > span,
.settings-connections-panel__detail em {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-connections-panel__detail {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3);
}

.settings-connections-panel__upgrade {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.settings-connections-panel__upgrade:hover,
.settings-connections-panel__upgrade:focus-visible {
  text-decoration: underline;
}

.settings-connections-panel__upgrade:disabled {
  cursor: default;
  opacity: 0.6;
}

.settings-connections-panel__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.settings-connections-panel__actions button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.settings-connections-panel__actions button:hover,
.settings-connections-panel__actions button:focus-visible {
  color: var(--color-text);
}

.settings-connections-panel__actions svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.settings-connections-panel__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-text-muted);
}

.settings-connections-panel__dot--ready {
  background: var(--color-success);
}

.settings-connections-panel__dot--checking {
  background: var(--color-warning);
}

.settings-connections-panel__dot--error {
  background: var(--color-error);
}

.settings-connections-panel__dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: 400px;
  overflow: auto;
}

.settings-connections-panel__browse {
  align-self: stretch;
  border: 0;
  border-left: 1px solid var(--color-border);
  border-radius: 0 calc(var(--radius-lg) - 1px) calc(var(--radius-lg) - 1px) 0;
  background: var(--color-surface-low);
}
</style>
