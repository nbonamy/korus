<template>
  <SettingsPanelFrame :title="$t('surface.instructionSettings.personalization')" title-id="settings-personalization-title">
    <template #banner>
      <SettingsIntro kind="personalization" :title="$t('surface.instructionSettings.personalizationIntroTitle')" :description="$t('surface.instructionSettings.personalizationIntroDescription')" />
    </template>
    <div class="settings-personalization__toolbar">
          <el-select class="settings-personalization__engine" :model-value="engine" :disabled="busy" :aria-label="$t('surface.instructionSettings.engine')" @update:model-value="selectEngine">
            <el-option :label="$t('surface.settingsSidebar.codex')" value="codex" />
            <el-option :label="$t('surface.settingsSidebar.claudeCode')" value="claude" />
          </el-select>
      <div class="settings-personalization__actions">
        <button class="app-button app-button--secondary" type="button" :disabled="busy || !loaded" @click="saveAll">{{ $t('surface.instructionSettings.saveAll') }}</button>
      </div>
    </div>
    <p class="settings-personalization__path">{{ filePath }}</p>
    <el-input v-model="text" type="textarea" :rows="10" :disabled="busy || !loaded" :aria-label="$t('surface.instructionSettings.developerInstructions')" @input="scheduleCurrent" />
    <p class="settings-personalization__hint">{{ $t('surface.instructionSettings.personalizationHint') }}</p>
    <p v-if="error || saveError" role="alert">{{ error || saveError }}</p>
  </SettingsPanelFrame>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useDebouncedSave } from '../shared/use-debounced-save';
import { ElMessageBox } from 'element-plus';
import type { AgentBackend, AppApi } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { translate } from '../i18n';
import SettingsPanelFrame from './SettingsPanelFrame.vue';
import SettingsIntro from './SettingsIntro.vue';

const props = defineProps<{ api?: Pick<AppApi, 'readEngineInstructions' | 'saveEngineInstructions'> }>();
const engine = ref<AgentBackend>('codex');
const text = ref('');
const original = ref('');
const filePath = ref('');
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const { schedule, flush, error: saveError } = useDebouncedSave(async (input: { engine: AgentBackend; text: string }) => {
  const client = props.api ?? appApi;
  if (!client) throw new Error('Settings client unavailable.');
  await client.saveEngineInstructions(input);
  if (engine.value === input.engine) original.value = input.text;
});
function scheduleCurrent() { schedule({ engine: engine.value, text: text.value }); }
async function load(next: AgentBackend) {
  busy.value = true;
  error.value = '';
  loaded.value = false;
  try {
    const client = props.api ?? appApi;
    if (!client) throw new Error('Settings client unavailable.');
    const result = await client.readEngineInstructions(next);
    engine.value = next;
    text.value = original.value = result.text;
    filePath.value = result.path;
    loaded.value = true;
  } catch (cause) {
    error.value = String(cause instanceof Error ? cause.message : cause);
  } finally { busy.value = false; }
}
async function selectEngine(next: AgentBackend) {
  if (text.value !== original.value) scheduleCurrent();
  busy.value = true;
  if (!await flush()) { busy.value = false; return; }
  await load(next);
}
async function saveAll() {
  try { await ElMessageBox.confirm(translate('surface.instructionSettings.overwriteBoth'), translate('surface.instructionSettings.saveAll'), { type: 'warning', confirmButtonText: translate('surface.instructionSettings.overwrite') }); }
  catch { return; }
  busy.value = true;
  error.value = '';
  try {
    if (!await flush()) return;
    const client = props.api ?? appApi;
    if (!client) throw new Error('Settings client unavailable.');
    await client.saveEngineInstructions({ engine: engine.value, text: text.value, all: true, confirmed: true });
    original.value = text.value;
  } catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause); }
  finally { busy.value = false; }
}
onMounted(() => load('codex'));
</script>

<style scoped>
.settings-personalization__path, .settings-personalization__hint { margin: var(--space-8) 0; color: var(--color-text-muted); font-size: var(--font-size-12); }
.settings-personalization__path { overflow-wrap: anywhere; }
.settings-personalization__toolbar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-8); }
.settings-personalization__engine { width: 160px; }
.settings-personalization__actions { display: flex; align-items: center; gap: var(--space-8); }
</style>
