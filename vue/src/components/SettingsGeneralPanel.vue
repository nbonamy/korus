<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsGeneralPanel.general')"
    title-id="settings-general-title"
  >
    <FormSection
      :title="$t('surface.settingsGeneralPanel.behavior')"
      title-id="settings-general-behavior-title"
    >
      <FormRow
        :title="$t('surface.settingsGeneralPanel.followUpBehavior')"
        :description="$t('surface.settingsGeneralPanel.followUpShortcuts', { modifier: followUpModifier })"
      >
        <template #control>
          <el-segmented
            :model-value="settings.followUpBehavior"
            :options="followUpOptions"
            :aria-label="$t('surface.settingsGeneralPanel.followUpBehavior')"
            @update:model-value="updateFollowUpBehavior"
          />
        </template>
      </FormRow>
      <FormRow
        v-if="appHostCapabilities.daemonManagement"
        as="label"
        :title="$t('surface.settingsGeneralPanel.preventSleepWhileAgentsRun')"
        :description="$t('surface.settingsGeneralPanel.keepThisComputerAwakeWhileAnAgentIsActive')"
      >
        <template #control>
          <el-switch
            :model-value="settings.preventSleepWhenAgentsRun"
            :aria-label="$t('surface.settingsGeneralPanel.preventSleepWhileAgentsRun')"
            @update:model-value="updatePreventSleep"
          />
        </template>
      </FormRow>
      <FormRow
        as="label"
        :title="$t('surface.settingsGeneralPanel.agentCelebrations')"
        :description="$t('surface.settingsGeneralPanel.letAgentsCelebrateMeaningfulWinsWithVisualEffects')"
      >
        <template #control>
          <el-switch
            :model-value="settings.celebrationsEnabled"
            :aria-label="$t('surface.settingsGeneralPanel.agentCelebrations')"
            @update:model-value="updateCelebrationsEnabled"
          />
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      v-if="appHostCapabilities.nativeFileDialogs && showSourceFolderSetting"
      :title="$t('surface.settingsGeneralPanel.sourceFolder')"
      title-id="settings-general-source-title"
    >
      <FormRow
        :title="$t('surface.settingsGeneralPanel.sourceFolder')"
        :description="$t('surface.settingsGeneralPanel.discoverRepositoriesAndWorktreesWhenCreatingAgents')"
        :error="sourceFolderError"
      >
        <template #control>
          <span class="settings-general-panel__actions settings-general-panel__actions--source">
            <span
              class="settings-general-panel__path"
              :title="sourceFolderLabel"
            >
              {{ sourceFolderLabel }}
            </span>
            <el-button
              size="small"
              :loading="choosingSourceFolder"
              @click="chooseSourceFolder"
            > {{ $t('surface.settingsGeneralPanel.choose') }} </el-button>
            <el-button
              v-if="sourceFolderState.path"
              size="small"
              @click="clearSourceFolder"
            > {{ $t('surface.settingsGeneralPanel.clear') }} </el-button>
          </span>
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      v-if="appHostCapabilities.systemPermissions"
      :title="$t('surface.settingsGeneralPanel.systemPermissions')"
      title-id="settings-general-permissions-title"
    >
      <FormRow
        :title="$t('surface.settingsGeneralPanel.accessibility')"
        :description="accessibilityDescription"
      >
        <template #control>
          <span class="settings-general-panel__actions">
            <span
              class="settings-general-panel__status"
              :class="{ 'settings-general-panel__status--granted': accessibilityGranted }"
            >
              <ShieldCheckIcon aria-hidden="true" />
              {{ accessibilityStatusLabel }}
            </span>
            <el-button
              v-if="showAccessibilityGrantButton"
              :loading="openingAccessibilitySettings"
              size="small"
              @click="grantAccessibility"
            > {{ $t('surface.settingsGeneralPanel.grant') }} </el-button>
            <el-button
              v-else-if="permissions?.accessibility.required"
              :loading="loadingPermissions"
              size="small"
              @click="loadPermissions"
            > {{ $t('surface.settingsGeneralPanel.refresh') }} </el-button>
          </span>
        </template>
      </FormRow>
      <FormRow
        :title="$t('surface.settingsGeneralPanel.screenRecording')"
        :description="screenRecordingDescription"
      >
        <template #control>
          <span class="settings-general-panel__actions">
            <span
              class="settings-general-panel__status"
              :class="{ 'settings-general-panel__status--granted': screenRecordingGranted }"
            >
              <ShieldCheckIcon aria-hidden="true" />
              {{ screenRecordingStatusLabel }}
            </span>
            <el-button
              v-if="showScreenRecordingGrantButton"
              :loading="openingScreenRecordingSettings"
              size="small"
              @click="grantScreenRecording"
            > {{ $t('surface.settingsGeneralPanel.grant') }} </el-button>
            <el-button
              v-else-if="permissions?.screenRecording.required"
              :loading="loadingPermissions"
              size="small"
              @click="loadPermissions"
            > {{ $t('surface.settingsGeneralPanel.refresh') }} </el-button>
          </span>
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      v-if="appHostCapabilities.daemonManagement"
      :title="$t('surface.settingsGeneralPanel.advanced')"
      title-id="settings-general-advanced-title"
    >
      <FormRow
        v-if="appHostCapabilities.daemonManagement"
        as="label"
        :title="$t('surface.settingsGeneralPanel.keepAppReadyInTheBackground')"
        :description="daemonDescription"
        :error="daemonStatusError"
      >
        <template #control>
          <span class="settings-general-panel__actions">
            <span
              class="settings-general-panel__status"
              :class="{
                'settings-general-panel__status--loading': daemonOperation !== null,
              }"
            >
              <span
                v-if="daemonOperation !== null"
                class="settings-general-panel__spinner"
                aria-hidden="true"
              />
              <Circle
                v-else
                class="settings-general-panel__status-icon"
                :class="{ 'settings-general-panel__status-icon--ok': daemonEnabled }"
                aria-hidden="true"
              />
              {{ daemonStatusLabel }}
            </span>
            <el-switch
              :model-value="daemonEnabled"
              :disabled="daemonSwitchDisabled"
              :aria-label="$t('surface.settingsGeneralPanel.keepAppReadyInTheBackground')"
              @update:model-value="updateDaemonEnabled"
            />
          </span>
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { rendererPlatform } from '../renderer-platform';
import { translate } from '../i18n';
import { ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import type { AppGeneralSettings, DaemonStatus, SourceFolderState, SystemPermissionsStatus, UpdateSettingsInput } from '@workspace/core/contracts';
import { defaultSourceFolderState } from '@workspace/core/settings';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import { Circle, ShieldCheckIcon } from '../shared/icons/app-icons';
import { appHostCapabilities, appApi } from '../platform-api';

const defaultPermissionsStatus: SystemPermissionsStatus = {
  platform: 'unknown',
  accessibility: {
    required: false,
    trusted: true,
  },
  screenRecording: {
    required: false,
    trusted: true,
  },
};

const props = defineProps<{
  chooseSourceFolder?: () => Promise<string | null>;
  daemonStatus?: DaemonStatus | null;
  daemonStatusError?: string | null;
  getSystemPermissions?: () => Promise<SystemPermissionsStatus>;
  openAccessibilitySettings?: () => Promise<SystemPermissionsStatus>;
  openScreenRecordingSettings?: () => Promise<SystemPermissionsStatus>;
  restartApp?: () => Promise<void>;
  setDaemonEnabled?: (enabled: boolean) => Promise<void>;
  settings: AppGeneralSettings;
  sourceFolder?: SourceFolderState;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>();

const permissions = ref<SystemPermissionsStatus | null>(null);
const loadingPermissions = ref(false);
const openingAccessibilitySettings = ref(false);
const openingScreenRecordingSettings = ref(false);
const choosingSourceFolder = ref(false);
const settingDaemon = ref(false);
const daemonOperation = ref<'installing' | 'uninstalling' | null>(null);
const sourceFolderError = ref<string | null>(null);

const followUpOptions = computed(() => [
  { label: translate('surface.settingsGeneralPanel.queue'), value: 'queue' },
  { label: translate('surface.settingsGeneralPanel.steer'), value: 'steer' },
]);
const followUpModifier = rendererPlatform(navigator.platform, navigator.userAgent) === 'macos' ? '⌘' : 'Ctrl';

const showSourceFolderSetting = computed(() => Boolean(props.sourceFolder));
const sourceFolderState = computed(() => props.sourceFolder ?? defaultSourceFolderState);
const sourceFolderLabel = computed(() => sourceFolderState.value.path || translate('dynamic.misc.notConfigured'));
const daemonEnabled = computed(() => props.daemonStatus?.installed ?? false);
const daemonSwitchDisabled = computed(() => settingDaemon.value || props.daemonStatus?.supported !== true);
const daemonStatusLabel = computed(() => {
  if (daemonOperation.value === 'installing') {
    return translate('surface.settingsGeneralPanel.installing');
  }
  if (daemonOperation.value === 'uninstalling') {
    return translate('surface.settingsGeneralPanel.uninstalling');
  }
  if (!props.daemonStatus) {
    return translate('surface.settingsGeneralPanel.checking');
  }
  if (!props.daemonStatus.supported) {
    return translate('surface.settingsGeneralPanel.unavailable');
  }
  if (props.daemonStatus.running) {
    return translate('surface.settingsGeneralPanel.running');
  }
  return props.daemonStatus.installed ? translate('surface.settingsGeneralPanel.installed') : translate('surface.settingsGeneralPanel.off');
});
const daemonDescription = computed(() => {
  if (props.daemonStatus?.supported === false) {
    return props.daemonStatus.detail ?? translate('dynamic.misc.installAvailable');
  }
  return translate('surface.settingsGeneralPanel.startTheAppAgentToKeepYourAutomationsRunning');
});
const accessibilityGranted = computed(() => permissions.value?.accessibility.trusted ?? false);
const showAccessibilityGrantButton = computed(() => permissions.value?.accessibility.required === true && !accessibilityGranted.value);
const screenRecordingGranted = computed(() => permissions.value?.screenRecording.trusted ?? false);
const showScreenRecordingGrantButton = computed(() => permissions.value?.screenRecording.required === true && !screenRecordingGranted.value);
const accessibilityStatusLabel = computed(() => {
  if (!permissions.value) {
    return translate('surface.settingsGeneralPanel.checking');
  }

  if (!permissions.value.accessibility.required) {
    return translate('surface.settingsGeneralPanel.notNeeded');
  }

  return accessibilityGranted.value ? translate('surface.settingsGeneralPanel.granted') : translate('surface.settingsGeneralPanel.required');
});
const accessibilityDescription = computed(() => {
  if (permissions.value?.accessibility.required === false) {
    return translate('surface.settingsGeneralPanel.computerUseDoesNotNeedThisPermissionOnThisPlatform');
  }

  return translate('surface.settingsGeneralPanel.requiredForComputerUseToInspectAndClickApp');
});
const screenRecordingStatusLabel = computed(() => {
  if (!permissions.value) {
    return translate('surface.settingsGeneralPanel.checking');
  }

  if (!permissions.value.screenRecording.required) {
    return translate('surface.settingsGeneralPanel.notNeeded');
  }

  return screenRecordingGranted.value ? translate('surface.settingsGeneralPanel.granted') : translate('surface.settingsGeneralPanel.required');
});
const screenRecordingDescription = computed(() => {
  if (permissions.value?.screenRecording.required === false) {
    return translate('surface.settingsGeneralPanel.appshotsDoNotNeedThisPermissionOnThisPlatform');
  }

  return translate('surface.settingsGeneralPanel.requiredForAppshotsToCaptureTheFrontmostWindow');
});

onMounted(() => {
  if (appHostCapabilities.systemPermissions) void loadPermissions();
});

async function loadPermissions(): Promise<void> {
  loadingPermissions.value = true;
  try {
    permissions.value = await (props.getSystemPermissions ?? getSystemPermissions)();
  } finally {
    loadingPermissions.value = false;
  }
}

async function grantAccessibility(): Promise<void> {
  openingAccessibilitySettings.value = true;
  try {
    permissions.value = await (props.openAccessibilitySettings ?? openAccessibilitySettings)();
  } finally {
    openingAccessibilitySettings.value = false;
  }
}

async function grantScreenRecording(): Promise<void> {
  openingScreenRecordingSettings.value = true;
  try {
    permissions.value = await (props.openScreenRecordingSettings ?? openScreenRecordingSettings)();
  } finally {
    openingScreenRecordingSettings.value = false;
  }
}

async function chooseSourceFolder(): Promise<void> {
  sourceFolderError.value = null;
  choosingSourceFolder.value = true;
  try {
    const selected = await props.chooseSourceFolder?.();
    if (selected) {
      await props.updateSettings?.({
        sourceFolder: {
          path: selected,
        },
      });
    }
  } catch (error) {
    sourceFolderError.value = error instanceof Error ? error.message : String(error);
  } finally {
    choosingSourceFolder.value = false;
  }
}

function clearSourceFolder(): void {
  sourceFolderError.value = null;
  void props.updateSettings?.({
    sourceFolder: {
      path: '',
    },
  });
}

async function getSystemPermissions(): Promise<SystemPermissionsStatus> {
  return appApi?.getSystemPermissions?.() ?? defaultPermissionsStatus;
}

async function openAccessibilitySettings(): Promise<SystemPermissionsStatus> {
  return appApi?.openAccessibilitySettings?.() ?? defaultPermissionsStatus;
}

async function openScreenRecordingSettings(): Promise<SystemPermissionsStatus> {
  return appApi?.openScreenRecordingSettings?.() ?? defaultPermissionsStatus;
}

function updatePreventSleep(value: boolean | string | number): void {
  void props.updateSettings?.({
    general: {
      preventSleepWhenAgentsRun: value === true,
    },
  });
}

function updateFollowUpBehavior(value: string | number | boolean): void {
  if (value !== 'queue' && value !== 'steer') return;
  void props.updateSettings?.({ general: { followUpBehavior: value } });
}

function updateCelebrationsEnabled(value: boolean | string | number): void {
  void props.updateSettings?.({
    general: {
      celebrationsEnabled: value === true,
    },
  });
}

async function updateDaemonEnabled(value: boolean | string | number): Promise<void> {
  const enabled = value === true;
  daemonOperation.value = enabled ? 'installing' : 'uninstalling';
  settingDaemon.value = true;
  try {
    await props.setDaemonEnabled?.(enabled);
    await promptForRestartAfterDaemonChange(enabled);
  } finally {
    settingDaemon.value = false;
    daemonOperation.value = null;
  }
}

async function promptForRestartAfterDaemonChange(enabled: boolean): Promise<void> {
  try {
    await ElMessageBox.confirm(
      enabled
        ? translate('surface.settingsGeneralPanel.appNeedsToRestartToConnectToTheBackgroundAgent')
        : translate('surface.settingsGeneralPanel.appNeedsToRestartToUseTheInAppAgent'),
      translate('surface.settingsGeneralPanel.restartApp'),
      {
        cancelButtonText: translate('common.later'),
        confirmButtonText: translate('dynamic.misc.restartNow'),
        distinguishCancelAndClose: true,
        type: 'info',
      },
    );
  } catch {
    return;
  }

  await props.restartApp?.();
}
</script>

<style scoped>
.settings-general-panel__actions {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  justify-content: flex-end;
  gap: var(--space-8);
}

.settings-general-panel__actions--source {
  width: min(360px, 100%);
}

.settings-general-panel__path {
  min-width: 0;
  max-width: 220px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-6);
  color: var(--color-text);
  background: var(--color-surface-low);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-general-panel__status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-20);
}

.settings-general-panel__status svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  stroke-width: 2;
}

.settings-general-panel__status--granted {
  color: var(--color-success);
}

.settings-general-panel__status--loading {
  color: var(--color-text-muted);
  font-weight: var(--font-weight-regular);
}

.settings-general-panel__status-icon--ok {
  color: var(--color-success);
  fill: currentColor;
}

.settings-general-panel__spinner {
  width: var(--icon-sm);
  height: var(--icon-sm);
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 999px;
  animation: settings-general-panel-spin 0.8s linear infinite;
}

@keyframes settings-general-panel-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 780px) {
  .settings-general-panel__actions--source {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
