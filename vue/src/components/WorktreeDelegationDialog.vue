<template>
  <FormDialog :model-value="true" :title="t('delegation.submit')" @update:model-value="close">
    <form class="app-form-dialog" @submit.prevent="submit">
      <FormField :label="t('delegation.startingContext')">
        <el-select v-model="startingContext" :disabled="busy" :aria-label="t('delegation.startingContext')">
          <el-option value="conversation" :label="t('delegation.conversation')" />
          <el-option value="handoff" :label="t('delegation.handoff')" />
        </el-select>
        <p class="app-form-dialog__help">{{ t('delegation.contextDescription') }}</p>
      </FormField>
      <FormField :label="t('delegation.taskInstructions')" label-for="delegation-task-instructions">
        <el-input id="delegation-task-instructions" v-model="instructions" type="textarea" :rows="4" :disabled="busy" :placeholder="t('delegation.taskInstructionsPlaceholder')" :aria-label="t('delegation.taskInstructions')" />
        <p class="app-form-dialog__help">{{ t('delegation.taskInstructionsDescription') }}</p>
      </FormField>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
      <button class="app-button app-button--primary" type="button" :disabled="busy" @click="submit">{{ t('delegation.submit') }}</button>
    </template>
  </FormDialog>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DelegationOverrides, DelegationStartingContext } from '@workspace/core/delegation-context';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
const props = defineProps<{ startingContext: DelegationStartingContext; delegate: (overrides: DelegationOverrides) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const startingContext = ref(props.startingContext);
const instructions = ref('');
const busy = ref(false);
const error = ref('');
function close(): void { if (!busy.value) emit('close'); }
async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.delegate({ startingContext: startingContext.value, ...(instructions.value.trim() ? { instructions: instructions.value.trim() } : {}) });
    emit('close');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
</script>
