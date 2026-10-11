<template>
  <FormDialog :model-value="modelValue" :title="$t('branchWork.title')" :subtitle="$t('branchWork.description')" width="600px" @update:model-value="dismiss">
    <p v-if="loading" role="status">{{ $t('branchWork.loading') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="preview?.recoveries?.length && !result" class="branch-work__result">
      <button v-for="recovery in preview.recoveries" :key="recovery.input.requestId" class="app-button app-button--secondary" type="button" :disabled="busy" @click="resume(recovery.input, recovery.result)">{{ $t('branchWork.resume', { branch: recovery.input.branchName }) }}</button>
    </div>
    <div v-if="preview && !result" class="branch-work__form">
      <FormField :label="$t('branchWork.branchName')" label-for="branch-work-name"><input id="branch-work-name" v-model="branchName" name="branch" :disabled="busy || Boolean(request)" autocomplete="off" /></FormField>
      <FormField :label="$t('branchWork.message')" label-for="branch-work-message"><input id="branch-work-message" v-model="message" name="message" :disabled="busy || Boolean(request)" /></FormField>
      <FormField :label="$t('branchWork.task')" label-for="branch-work-task"><textarea id="branch-work-task" v-model="prompt" name="prompt" :disabled="busy || Boolean(request)" rows="3" /></FormField>
      <fieldset class="branch-work__files" :disabled="busy || Boolean(request)">
        <legend>{{ $t('branchWork.selection') }}</legend>
        <p class="branch-work__hint">{{ $t('branchWork.wholePaths') }}</p>
        <label v-for="file in preview.files" :key="file.path" class="branch-work__file">
          <input v-model="paths" type="checkbox" :value="file.path" />
          <code>{{ file.path }}</code>
          <span>{{ file.indexStatus === '?' ? $t('branchWork.untracked') : $t('branchWork.status', { staged: file.indexStatus.trim() || '—', unstaged: file.worktreeStatus.trim() || '—' }) }}</span>
          <strong v-if="file.sensitive">{{ $t('branchWork.sensitive') }}</strong>
        </label>
        <p v-if="!preview.files.length">{{ $t('branchWork.empty') }}</p>
      </fieldset>
    </div>
    <div v-if="result" class="branch-work__result" role="status">
      <p>{{ result.state === 'completed' ? $t('branchWork.completed') : $t('branchWork.recovery') }}</p>
      <code>{{ result.folder }}</code>
      <p v-if="result.detail">{{ result.detail }}</p>
      <p v-if="result.agentId">{{ $t('branchWork.agent', { id: result.agentId }) }}</p>
      <p v-if="result.sourceBackupFolder">{{ $t('branchWork.backups', { folder: result.sourceBackupFolder }) }}</p>
      <p v-if="result.commit">{{ $t('branchWork.commit', { sha: result.commit }) }}</p>
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
import { computed, ref, watch } from 'vue';
import type { BranchWorkInput, BranchWorkPreview, BranchWorkResult } from '@workspace/core/branch-current-work';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { translate } from '../i18n';
import { localizedErrorMessage } from '../i18n/errors';

const props = defineProps<{
  modelValue: boolean;
  agentId: string;
  load(agentId: string): Promise<BranchWorkPreview>;
  transfer(agentId: string, input: BranchWorkInput): Promise<BranchWorkResult>;
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; transferred: [BranchWorkResult]; 'inspect-agent': [string] }>();
const preview = ref<BranchWorkPreview>();
const result = ref<BranchWorkResult>();
const error = ref<string>();
const loading = ref(false);
const busy = ref(false);
const branchName = ref('');
const message = ref('');
const prompt = ref('');
const paths = ref<string[]>([]);
const request = ref<BranchWorkInput>();
const valid = computed(() => preview.value && branchName.value.trim() && message.value.trim() && prompt.value.trim() && paths.value.length);
watch(() => props.modelValue, open => { if (open && !busy.value && result.value?.state !== 'recovery') void refresh(); }, { immediate: true });
async function refresh(): Promise<void> {
  loading.value = true;
  error.value = undefined;
  result.value = undefined;
  request.value = undefined;
  preview.value = undefined;
  try {
    preview.value = await props.load(props.agentId);
    paths.value = preview.value.files.filter(file => file.indexStatus !== '?' && !file.sensitive).map(file => file.path);
  } catch (cause) { error.value = localizedErrorMessage(cause, translate); }
  finally { loading.value = false; }
}
function resume(input: BranchWorkInput, saved: BranchWorkResult): void {
  request.value = { ...input, paths: [...input.paths] };
  result.value = saved;
}
function dismiss(open: boolean): void { if (!busy.value) emit('update:modelValue', open); }
async function submit(): Promise<void> {
  if (busy.value || (!request.value && !valid.value)) return;
  request.value ??= { confirmed: true, requestId: crypto.randomUUID(), snapshotId: preview.value!.snapshotId, branchName: branchName.value.trim(), paths: [...paths.value], message: message.value.trim(), prompt: prompt.value.trim() };
  busy.value = true;
  error.value = undefined;
  try {
    result.value = await props.transfer(props.agentId, request.value);
    if (result.value.state === 'completed') emit('transferred', result.value);
  } catch (cause) { error.value = localizedErrorMessage(cause, translate); }
  finally { busy.value = false; }
}
</script>

<style scoped>
.branch-work__form,
.branch-work__result {
  display: grid;
  gap: var(--space-6);
}

.branch-work__form input:not([type="checkbox"]),
.branch-work__form textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  color: var(--color-text);
  background: var(--color-surface-lowest);
  font: inherit;
}

.branch-work__files {
  min-width: 0;
  max-height: 240px;
  overflow: auto;
  border: 0;
  padding: 0;
}

.branch-work__file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
}

.branch-work__file code,
.branch-work__result code {
  overflow-wrap: anywhere;
}

.branch-work__file span,
.branch-work__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.branch-work__file strong {
  color: var(--color-warning);
  font-size: var(--font-size-12);
}
</style>
