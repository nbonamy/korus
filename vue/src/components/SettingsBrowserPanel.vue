<template>
  <SettingsPanelFrame :title="$t('surface.browserExtensions.browser')" title-id="settings-browser-title">
    <template #banner>
      <SettingsIntro kind="browser" :title="$t('surface.browserExtensions.introTitle')" :description="$t('surface.browserExtensions.profileHint')" />
    </template>
    <FormSection :title="$t('surface.browserExtensions.extensions')" title-id="settings-browser-extensions">
      <p v-if="!profileId" class="browser-settings__message">{{ $t('surface.browserExtensions.chooseAgent') }}</p>
      <template v-else>
        <FormRow
          v-for="extension in extensions"
          :key="extension.id"
          :title="extension.name"
          :description="
            extension.version
              ? `${extension.version}${extension.enabled ? '' : ' · ' + $t('surface.browserExtensions.disabled')}`
              : $t('surface.browserExtensions.notInstalled')
          "
          :error="extension.error"
        >
          <template #leading><BrowserExtensionIcon :id="extension.id" size="large" /></template>
          <template #control>
            <el-button
              v-if="!extension.version"
              :aria-label="`Install ${extension.name}`"
              :disabled="pending"
              :loading="isBusy('install', extension.id)"
              :aria-busy="isBusy('install', extension.id) || undefined"
              @click="act('install', extension.id)"
              >{{ $t(isBusy('install', extension.id) ? 'surface.browserExtensions.installing' : 'surface.browserExtensions.install') }}</el-button
            >
            <AppMenuButton
              v-else
              :ariaLabel="$t('surface.browserExtensions.actions', { name: extension.name })"
              :items="extensionActions(extension)"
              @select="selectAction(extension.id, $event)"
            >
              <template #trigger="{ attrs }">
                <button
                  v-bind="attrs"
                  class="app-icon-button"
                  type="button"
                  :aria-label="$t('surface.browserExtensions.actions', { name: extension.name })"
                  :title="$t('surface.browserExtensions.actions', { name: extension.name })"
                  :aria-busy="pendingAction?.id === extension.id || undefined"
                  :disabled="pending"
                >
                  <span v-if="pendingAction?.id === extension.id" class="app-spinner" aria-hidden="true" />
                  <DotsVerticalIcon v-else aria-hidden="true" />
                </button>
              </template>
            </AppMenuButton>
          </template>
        </FormRow>
      </template>
      <p v-if="error" role="alert" class="browser-settings__error">{{ error }}</p>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  supportedBrowserExtensions,
  type BrowserExtensionAction,
  type BrowserExtensionStatus,
} from '@workspace/core/browser-extensions';
import { appApi } from '../platform-api';
import { useAppState } from '../app-state';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import BrowserExtensionIcon from './BrowserExtensionIcon.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { CircleCheckIcon, CircleXIcon, DotsVerticalIcon, DownloadIcon, RefreshIcon, Trash2Icon } from '../shared/icons/app-icons';

const { t } = useI18n();
const props = defineProps<{ agentId?: string | null }>();
const app = useAppState();
const profileId = computed(() => (props.agentId === undefined ? app.snapshot.value.activeAgentId : props.agentId));
const extensions = ref<BrowserExtensionStatus[]>(
  supportedBrowserExtensions.map((extension) => ({ ...extension, enabled: false, permissions: [] })),
);
const pending = ref(false),
  error = ref('');
const pendingAction = ref<{ action: BrowserExtensionAction; id?: string } | null>(null);
function isBusy(action: BrowserExtensionAction, id: string): boolean {
  return pendingAction.value?.action === action && pendingAction.value.id === id;
}
function extensionActions(extension: BrowserExtensionStatus): AppMenuItem[] {
  return [
    { id: 'update', type: 'action', label: t('surface.browserExtensions.update'), icon: DownloadIcon, disabled: pending.value },
    { id: extension.enabled ? 'disable' : 'enable', type: 'action', label: t(extension.enabled ? 'surface.browserExtensions.disable' : 'surface.browserExtensions.enable'), icon: extension.enabled ? CircleXIcon : CircleCheckIcon, disabled: pending.value },
    { id: 'reinstall', type: 'action', label: t('surface.browserExtensions.reinstall'), icon: RefreshIcon, disabled: pending.value },
    { id: 'remove-separator', type: 'separator' },
    { id: 'remove', type: 'action', label: t('surface.browserExtensions.remove'), icon: Trash2Icon, danger: true, disabled: pending.value },
  ];
}
function selectAction(id: string, action: string): void {
  if (action === 'update' || action === 'enable' || action === 'disable' || action === 'reinstall' || action === 'remove') {
    void act(action, id);
  }
}
let sequence = 0;
async function act(action: BrowserExtensionAction, id?: string): Promise<void> {
  const agentId = profileId.value,
    request = ++sequence;
  if (!agentId || !appApi) return;
  pending.value = true;
  pendingAction.value = { action, id };
  error.value = '';
  try {
    const result = await appApi.browserExtensions(agentId, action, id);
    if (request !== sequence || profileId.value !== agentId) return;
    extensions.value = result.extensions;
  } catch (reason) {
    if (request === sequence) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (request === sequence) {
      pending.value = false;
      pendingAction.value = null;
    }
  }
}
watch(
  profileId,
  () => {
    void act('list');
  },
  { immediate: true },
);
</script>

<style scoped>
.browser-settings__message {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.browser-settings__error {
  color: var(--color-error);
  font-size: var(--font-size-13);
}
</style>
