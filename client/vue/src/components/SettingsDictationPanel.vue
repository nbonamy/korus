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
            <InputObfuscated class="settings-dictation__control" v-model="apiKey" @blur="commitApiKey" @commit="commitApiKey" :show-label="$t('dictation.showKey')" :hide-label="$t('dictation.hideKey')" :aria-label="$t('dictation.apiKey')" :placeholder="$t('dictation.enter')" :disabled="!keyLoaded || !settings.secureStorageAvailable" />
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
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { DictationSettings, DictationSettingsInput } from '@workspace/core/dictation';
import { useDebouncedSave } from '../shared/use-debounced-save';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import InputObfuscated from '../shared/form/InputObfuscated.vue';

const settings = ref<DictationSettings>();
const apiKey = ref('');
const keyLoaded = ref(false);
let savedKey = '';
let disposed = false;
const loadError = ref('');
const { schedule, flush, saving: busy, error: saveError } = useDebouncedSave(async (input: DictationSettingsInput) => {
  try {
    if (!appApi?.updateDictationSettings) throw new Error('Unavailable');
    settings.value = await appApi.updateDictationSettings(input);
    if (input.apiKey !== undefined) savedKey = input.apiKey ?? '';
  } catch { throw new Error(translate('dictation.failed')); }
});
onMounted(async () => {
  try {
    if (!appApi?.getDictationSettings) throw new Error('Unavailable');
    settings.value = await appApi.getDictationSettings();
    if (settings.value.hasApiKey && !appApi.getDictationApiKey) throw new Error('Unavailable');
    const key = settings.value.hasApiKey ? await appApi.getDictationApiKey!() : null;
    if (disposed) return;
    savedKey = key ?? '';
    apiKey.value = savedKey;
    keyLoaded.value = true;
  } catch { if (!disposed) loadError.value = translate('dictation.unavailable'); }
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
function commitApiKey(): void {
  if (!keyLoaded.value || apiKey.value.trim() === savedKey) return;
  schedule({ apiKey: apiKey.value.trim() || null });
  void flush();
}
onBeforeUnmount(() => { disposed = true; commitApiKey(); });
</script>

<style scoped>
.settings-dictation__control {
  width: 260px;
  max-width: 100%;
}
</style>
