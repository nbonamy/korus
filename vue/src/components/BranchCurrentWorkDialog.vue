<template>
  <FormDialog v-if="modelValue && !operationState" :model-value="modelValue" :title="$t('branchWork.title')" :subtitle="$t('branchWork.description')" width="600px" @update:model-value="dismiss">
    <p v-if="loading" role="status">{{ $t('branchWork.loading') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="preview?.recoveries?.length && !result" class="branch-work__result">
      <button v-for="recovery in preview.recoveries" :key="recovery.input.requestId" class="app-button app-button--secondary" type="button" :disabled="busy" @click="resume(recovery.input, recovery.result)">{{ $t('branchWork.resume', { branch: recovery.input.branchName }) }}</button>
    </div>
    <div v-if="preview && !result" class="branch-work__form">
      <input id="branch-work-name" v-model="branchName" name="branch" :aria-label="$t('branchWork.branchName')" :placeholder="$t('branchWork.branchPlaceholder')" :disabled="busy || Boolean(request)" autocomplete="off" autofocus />
    </div>
    <div v-if="result" class="branch-work__result" role="status">
      <p>{{ result.state === 'completed' ? $t('branchWork.completed') : $t('branchWork.recovery') }}</p>
      <code>{{ result.folder }}</code>
      <p v-if="result.detail">{{ result.detail }}</p>
      <p v-if="result.sourceBackupFolder">{{ $t('branchWork.backups', { folder: result.sourceBackupFolder }) }}</p>
      <p v-if="result.retainedPaths.length">{{ $t('branchWork.retained') }} {{ result.retainedPaths.join(', ') }}</p>
      <button v-if="result.agentId" class="app-button app-button--secondary" type="button" @click="emit('inspect-agent', result.agentId)">{{ $t('branchWork.inspect') }}</button>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="dismiss(false)">{{ result ? $t('branchWork.close') : $t('branchWork.cancel') }}</button>
      <button v-if="error && !result" class="app-button app-button--secondary" type="button" :disabled="busy" @click="refresh">{{ $t('branchWork.refresh') }}</button>
      <button v-if="result?.state !== 'completed'" class="app-button app-button--primary" type="button" :disabled="busy || (!result && !valid)" @click="submit">{{ busy ? $t('branchWork.working') : result || error ? $t('branchWork.retry') : $t('branchWork.submit') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { BranchWorkInput, BranchWorkPreview, BranchWorkResult, BranchWorkProgress } from '@workspace/core/branch-current-work';
import FormDialog from '../shared/dialog/FormDialog.vue';
import type { WorkspaceProvisioningOperation } from './WorkspaceProvisioningProgressDialog.vue';
import { isProvisioningBackgrounded, publishProvisioningOperation } from './provisioning-operations';
import { translate } from '../i18n';
import { localizedErrorMessage } from '../i18n/errors';

const props = defineProps<{
  modelValue: boolean;
  progress?: BranchWorkProgress | null;
  agentId: string;
  load(agentId: string): Promise<BranchWorkPreview>;
  transfer(agentId: string, input: BranchWorkInput): Promise<BranchWorkResult>;
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; transferred: [BranchWorkResult]; 'inspect-agent': [string]; started: [] }>();
const preview = ref<BranchWorkPreview>();
const result = ref<BranchWorkResult>();
const error = ref<string>();
const loading = ref(false);
const busy = ref(false);
const branchName = ref('');
const request = ref<BranchWorkInput>();
const operationState = ref<'running' | 'success' | 'error' | null>(null);
const operation = computed<WorkspaceProvisioningOperation | null>(() => {
  if (!props.modelValue || !operationState.value || !request.value) return null;
  const progress = props.progress?.id === request.value.requestId && props.progress.agentId === props.agentId ? props.progress : null;
  return { mode: 'branchMove', progress: {
    id: request.value.requestId, agentId: props.agentId, branchName: request.value.branchName,
    phase: progress?.phase ?? 'creatingWorktree', state: operationState.value,
    ...(error.value || result.value?.detail ? { error: error.value ?? result.value?.detail } : {}),
  } };
});
watch(operation, (value) => publishProvisioningOperation('branchMove', value, { onClose: completeOperation }), { immediate: true });
onBeforeUnmount(() => publishProvisioningOperation('branchMove', null));
const valid = computed(() => preview.value && branchName.value.trim());
watch(() => props.modelValue, open => { if (open && !busy.value && result.value?.state !== 'recovery') void refresh(); }, { immediate: true });
async function refresh(): Promise<void> {
  operationState.value = null;
  loading.value = true;
  error.value = undefined;
  result.value = undefined;
  request.value = undefined;
  preview.value = undefined;
  try {
    preview.value = await props.load(props.agentId);
  } catch (cause) { error.value = localizedErrorMessage(cause, translate); }
  finally { loading.value = false; }
}
function resume(input: BranchWorkInput, saved: BranchWorkResult): void {
  request.value = { ...input };
  result.value = saved;
}
function dismiss(open: boolean): void { if (!busy.value) emit('update:modelValue', open); }
async function submit(): Promise<void> {
  if (busy.value || (!request.value && !valid.value)) return;
  request.value ??= { confirmed: true, requestId: crypto.randomUUID(), snapshotId: preview.value!.snapshotId, branchName: branchName.value.trim() };
  emit('started');
  operationState.value = 'running';
  busy.value = true;
  error.value = undefined;
  try {
    result.value = await props.transfer(props.agentId, { ...request.value });
    operationState.value = result.value.state === 'completed' ? 'success' : 'error';
  } catch (cause) {
    error.value = localizedErrorMessage(cause, translate);
    operationState.value = 'error';
  }
  finally { busy.value = false; }
  // Backgrounded and clean: finish quietly instead of pulling the user into the new agent.
  if (isProvisioningBackgrounded(request.value.requestId) && result.value?.state === 'completed' && !result.value.retainedPaths.length) {
    operationState.value = null;
    emit('transferred', result.value);
    dismiss(false);
  }
}
function completeOperation(): void {
  operationState.value = null;
  if (result.value?.state !== 'completed') return;
  emit('transferred', result.value);
  if (result.value.retainedPaths.length) return;
  if (result.value.agentId) emit('inspect-agent', result.value.agentId);
  dismiss(false);
}
</script>

<style scoped>
.branch-work__form,
.branch-work__result {
  display: grid;
  gap: var(--space-6);
}

.branch-work__form {
  padding: var(--space-4) 0;
}

.branch-work__form input {
  box-sizing: border-box;
  width: 100%;
  border: 0;
  border-radius: 0;
  padding: var(--space-4) 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  outline: none;
}

.branch-work__result code {
  overflow-wrap: anywhere;
}
</style>
