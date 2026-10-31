<template>
  <FormDialog :model-value="true" :title="mode === 'rename' ? t('features.renameTitle') : t('features.deleteTitle', { feature: feature.label })" width="560px" :close-on-click-modal="!busy" :close-on-press-escape="!busy" @update:model-value="!$event && close()">
    <FormField v-if="mode === 'rename'" :label="t('features.label')" label-for="feature-label">
      <el-input id="feature-label" v-model="label" autofocus :maxlength="120" :disabled="busy" @keydown.enter.prevent="submit" />
    </FormField>
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
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
      <button class="app-button" :class="mode === 'delete' ? 'feature-dialog__delete' : 'app-button--primary'" type="button" :disabled="busy || (mode === 'rename' ? !label.trim() : !preview)" :aria-busy="busy" @click="submit">{{ mode === 'rename' ? t('features.save') : t('features.deleteAction') }}</button>
    </template>
  </FormDialog>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeatureGroupRequest, FeatureGroupResult, FeatureGroupPreview } from '@workspace/core/feature-groups';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { FolderIcon } from '../shared/icons/app-icons';
const props = defineProps<{ feature: { teamId: string; branch: string; label: string }; mode: 'rename' | 'delete'; request: (input: FeatureGroupRequest) => Promise<FeatureGroupResult> }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const label = ref(props.feature.label);
const preview = ref<FeatureGroupPreview | null>(null);
const busy = ref(false), error = ref('');
function close(): void { if (!busy.value) emit('close'); }
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
  if (busy.value || (props.mode === 'rename' ? !label.value.trim() : !preview.value)) return;
  busy.value = true; error.value = '';
  try {
    await props.request(props.mode === 'rename'
      ? { type: 'rename', teamId: props.feature.teamId, branch: props.feature.branch, label: label.value.trim() }
      : { type: 'delete', teamId: props.feature.teamId, branch: props.feature.branch, fingerprint: preview.value!.fingerprint, confirmed: true });
    emit('close');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    if (props.mode === 'delete') { try { await loadPreview(); } catch { preview.value = null; } }
  } finally { busy.value = false; }
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
