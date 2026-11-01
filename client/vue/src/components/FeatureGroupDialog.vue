<template>
  <FormDialog :model-value="true" :title="mode === 'rename' ? t('features.renameTitle') : t('features.deleteTitle', { feature: feature.label })" :compact="mode === 'rename'" :width="mode === 'rename' ? '420px' : '560px'" :close-on-click-modal="!busy" :close-on-press-escape="!busy" @update:model-value="!$event && close()">
    <GitOperationFeedback v-if="deleteOperation" status="running" :title="t('features.deleting')" :detail="feature.label">
      <template #icon><Trash2Icon /></template>
    </GitOperationFeedback>
    <form v-else-if="mode === 'rename'" class="app-form-dialog" @submit.prevent="submit">
      <ClearableTextInput id="feature-label" v-model="label" subtle autofocus select-on-mount :aria-label="t('features.label')" :placeholder="feature.branch" :maxlength="120" :disabled="busy" />
    </form>
    <div v-else class="feature-dialog__body" :aria-busy="busy">
      <p>{{ t('features.deleteDescription') }}</p>
      <p v-if="!preview && !error">{{ t('common.loading') }}</p>
      <ul v-if="preview" class="feature-dialog__worktrees" :aria-label="t('features.worktrees')">
        <li v-for="tree in preview.worktrees" :key="`${tree.remoteConnectionId ?? ''}:${tree.path}`">
          <FolderIcon aria-hidden="true" />
          <span><strong>{{ tree.repositoryName }}</strong><code>{{ tree.path }}</code><span v-if="tree.changedFiles" class="feature-dialog__warning">{{ t('features.changedFiles', { count: tree.changedFiles }) }}</span></span>
        </li>
      </ul>
    </div>
    <p v-if="error" class="feature-dialog__error" role="alert">{{ error }}</p>
    <template #footer>
      <button v-if="deleteOperation" class="app-button app-button--secondary" type="button" @click="runInBackground">{{ t('common.runInBackground') }}</button>
      <template v-else>
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button class="app-button" :class="mode === 'delete' ? 'feature-dialog__delete' : 'app-button--primary'" type="button" :disabled="busy || (mode === 'delete' && !preview)" :aria-busy="busy" @click="submit">{{ mode === 'rename' ? t('features.save') : t('features.deleteAction') }}</button>
      </template>
    </template>
  </FormDialog>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import type { FeatureGroupRequest, FeatureGroupResult, FeatureGroupPreview } from '@workspace/core/feature-groups';
import FormDialog from '../shared/dialog/FormDialog.vue';
import ClearableTextInput from '../shared/form/ClearableTextInput.vue';
import { FolderIcon, Trash2Icon } from '../shared/icons/app-icons';
import GitOperationFeedback from './GitOperationFeedback.vue';
import { translate } from '../i18n';
const props = defineProps<{ feature: { teamId: string; branch: string; label: string }; mode: 'rename' | 'delete'; request: (input: FeatureGroupRequest) => Promise<FeatureGroupResult> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const label = ref(props.feature.label === props.feature.branch ? '' : props.feature.label);
const preview = ref<FeatureGroupPreview | null>(null);
const busy = ref(false), error = ref('');
const deleteOperation = shallowRef<{ backgrounded: boolean } | null>(null);
function close(): void { if (!busy.value) emit('close'); }
function runInBackground(): void {
  if (!deleteOperation.value) return;
  deleteOperation.value.backgrounded = true;
  emit('close');
}
onBeforeUnmount(() => {
  if (deleteOperation.value) deleteOperation.value.backgrounded = true;
});
async function loadPreview(): Promise<void> {
  const result = await props.request({ type: 'preview-delete', teamId: props.feature.teamId, branch: props.feature.branch });
  if (result.kind !== 'preview') throw new Error('Feature preview unavailable.');
  preview.value = result.preview;
}
onMounted(async () => {
  if (props.mode !== 'delete') return;
  busy.value = true;
  try { await loadPreview(); } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
});
async function submit(): Promise<void> {
  if (busy.value || (props.mode === 'delete' && !preview.value)) return;
  const operation = props.mode === 'delete' ? { backgrounded: false } : null;
  const feature = props.feature.label;
  const count = preview.value?.worktrees.length ?? 0;
  deleteOperation.value = operation;
  busy.value = true; error.value = '';
  try {
    await props.request(props.mode === 'rename'
      ? { type: 'rename', teamId: props.feature.teamId, branch: props.feature.branch, label: label.value.trim() }
      : { type: 'delete', teamId: props.feature.teamId, branch: props.feature.branch, fingerprint: preview.value!.fingerprint, confirmed: true });
    if (operation?.backgrounded) ElMessage.success(translate('features.deleted', { feature, count }));
    else emit('close');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (operation?.backgrounded) {
      ElMessage.error(translate('features.deleteFailed', { feature, message }));
      return;
    }
    error.value = message;
    if (props.mode === 'delete') { try { await loadPreview(); } catch { preview.value = null; } }
  } finally { busy.value = false; deleteOperation.value = null; }
}
</script>
<style scoped>
.feature-dialog__body { display: grid; gap: var(--space-6); }
.feature-dialog__body p { margin: 0; }
.feature-dialog__worktrees { display: grid; gap: var(--space-6); list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; }
.feature-dialog__worktrees li { display: flex; align-items: flex-start; gap: var(--space-4); }
.feature-dialog__worktrees li > svg { flex: 0 0 auto; width: var(--icon-sm); height: var(--icon-sm); margin-top: var(--space-1); }
.feature-dialog__worktrees li > span { display: grid; min-width: 0; gap: var(--space-1); }
.feature-dialog__worktrees code { overflow-wrap: anywhere; color: var(--color-text-muted); font-size: var(--font-size-12); }
.feature-dialog__error,
.feature-dialog__warning { color: var(--color-error); }
.feature-dialog__delete { color: var(--color-on-error); border-color: var(--color-error); background: var(--color-error); }
</style>
