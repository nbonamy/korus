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
            <div class="browser-settings__actions">
              <el-button
                v-if="!extension.version"
                :aria-label="`Install ${extension.name}`"
                :disabled="pending"
                :loading="isBusy('install', extension.id)"
                :aria-busy="isBusy('install', extension.id) || undefined"
                @click="act('install', extension.id)"
                >{{ $t(isBusy('install', extension.id) ? 'surface.browserExtensions.installing' : 'surface.browserExtensions.install') }}</el-button
              >
              <template v-else>
                <el-button
                  :aria-label="`Update ${extension.name}`"
                  :disabled="pending"
                  :loading="isBusy('update', extension.id)"
                  :aria-busy="isBusy('update', extension.id) || undefined"
                  @click="act('update', extension.id)"
                  >{{ $t('surface.browserExtensions.update') }}</el-button
                >
                <el-button
                  :aria-label="`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`"
                  :disabled="pending"
                  :loading="isBusy(extension.enabled ? 'disable' : 'enable', extension.id)"
                  :aria-busy="isBusy(extension.enabled ? 'disable' : 'enable', extension.id) || undefined"
                  @click="act(extension.enabled ? 'disable' : 'enable', extension.id)"
                  >{{
                    $t(extension.enabled ? 'surface.browserExtensions.disable' : 'surface.browserExtensions.enable')
                  }}</el-button
                >
                <el-button
                  :aria-label="`Reinstall ${extension.name}`"
                  :disabled="pending"
                  :loading="isBusy('reinstall', extension.id)"
                  :aria-busy="isBusy('reinstall', extension.id) || undefined"
                  @click="act('reinstall', extension.id)"
                  >{{ $t('surface.browserExtensions.reinstall') }}</el-button
                >
                <el-button
                  :aria-label="`Remove ${extension.name}`"
                  :disabled="pending"
                  :loading="isBusy('remove', extension.id)"
                  :aria-busy="isBusy('remove', extension.id) || undefined"
                  @click="act('remove', extension.id)"
                  >{{ $t('surface.browserExtensions.remove') }}</el-button
                >
              </template>
            </div>
          </template>
        </FormRow>
      </template>
      <p v-if="message" role="status" class="browser-settings__message">{{ message }}</p>
      <p v-if="error" role="alert" class="browser-settings__error">{{ error }}</p>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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

const props = defineProps<{ agentId?: string | null }>();
const app = useAppState();
const profileId = computed(() => (props.agentId === undefined ? app.snapshot.value.activeAgentId : props.agentId));
const extensions = ref<BrowserExtensionStatus[]>(
  supportedBrowserExtensions.map((extension) => ({ ...extension, enabled: false, permissions: [] })),
);
const pending = ref(false),
  error = ref(''),
  message = ref('');
const pendingAction = ref<{ action: BrowserExtensionAction; id?: string } | null>(null);
function isBusy(action: BrowserExtensionAction, id: string): boolean {
  return pendingAction.value?.action === action && pendingAction.value.id === id;
}
let sequence = 0;
async function act(action: BrowserExtensionAction, id?: string): Promise<void> {
  const agentId = profileId.value,
    request = ++sequence;
  if (!agentId || !appApi) return;
  pending.value = true;
  pendingAction.value = { action, id };
  error.value = '';
  message.value = '';
  try {
    const result = await appApi.browserExtensions(agentId, action, id);
    if (request !== sequence || profileId.value !== agentId) return;
    extensions.value = result.extensions;
    message.value = result.message ?? '';
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
.browser-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}

.browser-settings__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.browser-settings__message {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.browser-settings__error {
  color: var(--color-error);
  font-size: var(--font-size-13);
}
</style>
