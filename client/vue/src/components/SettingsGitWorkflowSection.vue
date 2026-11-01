<template>
  <FormSection class="settings-git-workflow" :title="$t('gitWorkflow.title')">
    <FormRow v-for="kind in kinds" :key="kind" :title="$t(`gitWorkflow.${kind}`)">
      <template #control>
        <GitStrategySelect :model-value="preferences[kind]" :kind="kind" :label="$t(`gitWorkflow.${kind}`)" @update:model-value="updateStrategy(kind, $event)" />
      </template>
    </FormRow>
    <p v-if="error" role="alert">{{ error }}</p>
  </FormSection>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import { normalizeGitSettings } from '@workspace/core/git-preferences';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
import GitStrategySelect from './GitStrategySelect.vue';
const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const kinds = ['pull', 'update'] as const;
const preferences = computed(() => normalizeGitSettings(props.settings.git));
const error = ref('');
async function updateStrategy(kind: typeof kinds[number], value: string): Promise<void> {
  error.value = '';
  try {
    if (!props.updateSettings) throw new Error('Settings unavailable.');
    const next = normalizeGitSettings({ [kind]: value });
    await props.updateSettings({ general: { git: { [kind]: next[kind] } } });
  } catch (cause) { error.value = String(cause); }
}
</script>
<style scoped>
.settings-git-workflow :deep(.el-select) { width: 280px; max-width: 100%; }
</style>
