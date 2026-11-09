<template>
  <SettingsPanelFrame :title="$t('dictation.title')" title-id="settings-dictation-title">
    <template #banner>
      <SettingsIntro kind="dictation" :title="$t('dictation.introTitle')" :description="$t('dictation.introDescription')" />
    </template>
    <p v-if="loadError || saveError" role="alert">{{ loadError || saveError }}</p>
    <FormSection v-if="settings">
      <FormRow :title="$t('dictation.engine')">
        <template #control>
          <el-select class="settings-dictation__control" :model-value="settings.engine" :aria-label="$t('dictation.engine')" :disabled="busy" @update:model-value="selectEngine">
            <el-option v-if="settings.appleAvailable" value="apple" :label="$t('dictation.apple')" />
            <el-option value="openai" :label="$t('dictation.openai')" />
          </el-select>
        </template>
      </FormRow>
      <template v-if="settings.engine === 'openai'">
        <FormRow :title="$t('dictation.apiKey')">
          <template #control>
            <el-input class="settings-dictation__control" :model-value="apiKey" @update:model-value="updateApiKey" type="password" autocomplete="off" :aria-label="$t('dictation.apiKey')" :placeholder="$t('dictation.enter')" :disabled="busy || (!settings.secureStorageAvailable && !settings.hasApiKey)" />
          </template>
        </FormRow>
        <FormRow :title="$t('dictation.live')">
          <template #control>
            <el-switch :model-value="settings.openaiLiveTranscription" :aria-label="$t('dictation.live')" :disabled="busy" @update:model-value="setLive" />
          </template>
        </FormRow>
        <p v-if="!settings.secureStorageAvailable" role="status">{{ $t('dictation.locked') }}</p>
      </template>
    </FormSection>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { DictationSettings, DictationSettingsInput } from '@workspace/core/dictation';
import { useDebouncedSave } from '../shared/use-debounced-save';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';

const settings = ref<DictationSettings>();
// A presence marker, never the stored credential. It can be replaced or cleared.
const savedKeyMask = '••••••••';
const apiKey = ref('');
const loadError = ref('');
const { schedule, flush, saving: busy, error: saveError } = useDebouncedSave(async (input: DictationSettingsInput) => {
  try {
    if (!appApi?.updateDictationSettings) throw new Error('Unavailable');
    settings.value = await appApi.updateDictationSettings(input);
    if (typeof input.apiKey === 'string' && apiKey.value.trim() === input.apiKey) apiKey.value = savedKeyMask;
  } catch { throw new Error(translate('dictation.failed')); }
});
onMounted(async () => {
  try {
    if (!appApi?.getDictationSettings) throw new Error('Unavailable');
    settings.value = await appApi.getDictationSettings();
    apiKey.value = settings.value.hasApiKey ? savedKeyMask : '';
  } catch { loadError.value = translate('dictation.unavailable'); }
});
async function setLive(value: unknown): Promise<void> {
  if (typeof value !== 'boolean' || !await flush()) return;
  schedule({ openaiLiveTranscription: value });
  await flush();
}
async function selectEngine(engine: unknown): Promise<void> {
  if (engine !== 'apple' && engine !== 'openai') return;
  if (!await flush()) return;
  schedule({ engine });
  await flush();
}
function updateApiKey(value: string): void {
  // Editing the marker replaces it; placeholder characters must never be saved.
  apiKey.value = value.replaceAll('•', '');
  schedule({ apiKey: apiKey.value.trim() || null });
}
</script>

<style scoped>
.settings-dictation__control {
  width: 260px;
  max-width: 100%;
}
</style>
