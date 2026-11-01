<template>
  <SettingsPanelFrame
    :title="$t('surface.settingsPluginsPanel.plugins')"
    title-id="settings-plugins-title"
  >
    <template #banner>
      <SettingsIntro kind="plugins" :title="$t('surface.settingsPluginsPanel.introTitle')" :description="$t('surface.settingsPluginsPanel.introDescription')" />
    </template>

    <FormSection
      v-if="appHostCapabilities.computerUse"
      :title="$t('surface.settingsPluginsPanel.app')"
      title-id="settings-plugins-app-title"
    >
      <FormRow
        as="label"
        :title="$t('surface.settingsPluginsPanel.computerUse')"
        :error="computerUseError"
        :description="$t('surface.settingsPluginsPanel.letAgentsInspectAndControlMacOSAppsThroughTheLocalComput')"
      >
        <template #control>
          <el-switch
            :model-value="pluginSettings.computerUseEnabled"
            :aria-label="$t('surface.settingsPluginsPanel.enableComputerUse')"
            @update:model-value="updatePlugin('computerUse', $event)"
          />
        </template>
      </FormRow>
    </FormSection>

    <FormSection
      :title="$t('surface.settingsPluginsPanel.codex')"
      title-id="settings-plugins-codex-title"
    >
      <FormRow
        as="label"
        :title="$t('surface.settingsPluginsPanel.chrome')"
        :error="chromeError"
        :description="$t('surface.settingsPluginsPanel.letAgentsWorkWithYourExistingChromeTabsSessionsAndExtens')"
      >
        <template #control>
          <el-switch
            :model-value="chromeEnabled"
            :aria-label="$t('surface.settingsPluginsPanel.enableChrome')"
            @update:model-value="updatePlugin('chrome', $event)"
          />
        </template>
      </FormRow>
      <FormRow
        :title="$t('surface.settingsPluginsPanel.installCodexPluginsAndMCPServers')"
        :description="$t('surface.settingsPluginsPanel.gitHubSlackJiraLinearGmailGoogleDriveAndMore')"
        :error="pluginManagerError"
      >
        <template #control>
          <el-button
            circle
            :loading="managingPlugins"
            :aria-label="$t('surface.settingsPluginsPanel.installCodexPluginsAndMCPServers')"
            @click="managePlugins('install')"
          >
            <ChevronRightIcon aria-hidden="true" />
          </el-button>
        </template>
      </FormRow>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AppPluginSettings, AppPluginStatus, UpdateSettingsInput } from '@workspace/core/contracts';
import { defaultPluginSettings } from '@workspace/core/settings';
import { ChevronRightIcon } from '../shared/icons/app-icons';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
import { appHostCapabilities, appPlatformActions } from '../platform-api';

type PendingPlugin = 'computerUse' | 'chrome';

const props = withDefaults(defineProps<{
  settings?: AppPluginSettings;
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
  getPluginStatus?: () => Promise<AppPluginStatus>;
}>(), {
  settings: () => ({ ...defaultPluginSettings }),
  updateSettings: async () => undefined,
  getPluginStatus: undefined,
});

const managingPlugins = ref(false);
const computerUseError = ref<string | null>(null);
const chromeError = ref<string | null>(null);
const pluginManagerError = ref<string | null>(null);
const chromeEnabled = ref(false);
const pluginSettings = computed(() => props.settings ?? defaultPluginSettings);
let pluginStatusTimer: number | undefined;

async function refreshPluginStatus(): Promise<void> {
  if (!props.getPluginStatus) {
    chromeEnabled.value = props.settings?.chromeEnabled === true;
    return;
  }
  try {
    chromeEnabled.value = (await props.getPluginStatus()).chromeEnabled === true;
  } catch {
    // Preserve the last known status through transient config/IPC failures.
  }
}

watch(() => props.settings?.chromeEnabled, (value) => {
  if (!props.getPluginStatus) chromeEnabled.value = value === true;
});

onMounted(() => {
  void refreshPluginStatus();
  pluginStatusTimer = window.setInterval(() => { void refreshPluginStatus(); }, 5_000);
});

onBeforeUnmount(() => {
  if (pluginStatusTimer !== undefined) window.clearInterval(pluginStatusTimer);
});

function updatePlugin(plugin: PendingPlugin, enabled: boolean): void {
  if (plugin === 'chrome') {
    void managePlugins('chrome');
    return;
  }
  if (enabled) {
    void persistPlugin(plugin, true);
    return;
  }

  void persistPlugin(plugin, false);
}

async function persistPlugin(plugin: PendingPlugin, enabled: boolean): Promise<void> {
  const key = plugin === 'computerUse' ? 'computerUseEnabled' : 'chromeEnabled';
  const errorState = plugin === 'computerUse' ? computerUseError : chromeError;
  errorState.value = null;
  try {
    await props.updateSettings({ general: { plugins: { [key]: enabled } } });
  } catch (error) {
    errorState.value = error instanceof Error ? error.message : String(error);
  }
}

async function managePlugins(source: 'chrome' | 'install'): Promise<void> {
  const errorState = source === 'chrome' ? chromeError : pluginManagerError;
  managingPlugins.value = true;
  errorState.value = null;
  try {
    await appPlatformActions.managePlugins();
  } catch (error) {
    errorState.value = error instanceof Error ? error.message : String(error);
  } finally {
    managingPlugins.value = false;
  }
}
</script>

<style scoped>
.settings-plugins-panel :deep(.el-button.is-circle svg) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
