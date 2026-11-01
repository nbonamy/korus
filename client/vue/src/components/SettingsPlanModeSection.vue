<template>
  <FormSection :title="t('planModeSettings.title')" title-id="settings-workflows-plan-title">
    <FormRow :title="t('planModeSettings.interactive')" :description="t('planModeSettings.description')">
      <template #control>
        <el-switch :model-value="draft" :aria-label="t('planModeSettings.interactive')" @update:model-value="update" />
      </template>
    </FormRow>
    <p v-if="error" role="alert">{{ error }}</p>
  </FormSection>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppGeneralSettings, UpdateSettingsInput } from '@workspace/core/contracts';
import { useDebouncedSave } from '../shared/use-debounced-save';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';
const props = defineProps<{ settings: AppGeneralSettings; updateSettings?: (input: UpdateSettingsInput) => Promise<void> }>();
const { t } = useI18n();
const draft = ref(props.settings.useInteractivePlans !== false);
const persisted = ref(draft.value);
const { schedule, error } = useDebouncedSave(async (useInteractivePlans: boolean) => {
  if (!props.updateSettings) throw new Error('Settings client unavailable.');
  await props.updateSettings({ general: { useInteractivePlans } });
  persisted.value = useInteractivePlans;
});
function update(value: boolean) { draft.value = value; schedule(value); }
watch(() => props.settings.useInteractivePlans, value => {
  if (draft.value === persisted.value) draft.value = value !== false;
  persisted.value = value !== false;
});
</script>
