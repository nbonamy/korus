<template>
  <FormDialog
    :model-value="true"
    :title="preview ? t('repositoryDeletion.title', { name: preview.confirmationName }) : t('repositoryDeletion.action')"
    width="600px"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    @update:model-value="!$event && close()"
  >
    <div class="repository-delete-dialog__body" :aria-busy="busy || !preview && !error">
      <template v-if="preview">
        <p>
          <strong class="repository-delete-dialog__warning">{{ t('repositoryDeletion.warning') }}</strong>
          {{ t('repositoryDeletion.loss') }} {{ t('repositoryDeletion.remote') }}
        </p>
        <FormField :label="t('repositoryDeletion.confirmation', { name: preview.confirmationName })" label-for="repository-delete-confirmation">
          <el-input id="repository-delete-confirmation" v-model="confirmation" :disabled="busy" autocomplete="off" @keydown.enter.prevent="remove" />
        </FormField>
      </template>
      <p v-else-if="!error">{{ t('repositoryDeletion.loading') }}</p>
      <p v-if="error" role="alert" class="repository-delete-dialog__error">{{ error }}</p>
    </div>
    <template #footer-left>
      <span class="repository-delete-dialog__irreversible">
        <AlertTriangleIcon aria-hidden="true" />
        {{ t('repositoryDeletion.irreversible') }}
      </span>
    </template>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
      <button class="app-button app-button--danger repository-delete-dialog__delete" type="button" :disabled="!canDelete" :aria-busy="busy" @click="remove">
        {{ t(busy ? 'repositoryDeletion.deleting' : 'repositoryDeletion.action') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DeleteRepositoryInput, RepositoryDeletionPreview } from '@workspace/core/contracts/workspace';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { AlertTriangleIcon } from '../shared/icons/app-icons';

const props = defineProps<{
  agentId: string;
  loadPreview: (agentId: string) => Promise<RepositoryDeletionPreview>;
  removeRepository: (agentId: string, input: DeleteRepositoryInput) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const preview = ref<RepositoryDeletionPreview | null>(null);
const confirmation = ref('');
const busy = ref(false);
const error = ref('');
const canDelete = computed(() => Boolean(preview.value && confirmation.value === preview.value.confirmationName && !busy.value));

onMounted(async () => {
  try { preview.value = await props.loadPreview(props.agentId); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
});
function close(): void { if (!busy.value) emit('close'); }
async function remove(): Promise<void> {
  if (!canDelete.value || !preview.value) return;
  busy.value = true;
  error.value = '';
  try {
    await props.removeRepository(props.agentId, { confirmation: confirmation.value, fingerprint: preview.value.fingerprint });
    emit('close');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
</script>

<style scoped>
.repository-delete-dialog__body {
  display: grid;
  gap: var(--space-6);
}

.repository-delete-dialog__body p { margin: 0; }
.repository-delete-dialog__warning { font-weight: var(--font-weight-semibold); }
.repository-delete-dialog__error { color: var(--color-error); }

.repository-delete-dialog__irreversible {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-error);
  font-size: var(--font-size-12);
}

.repository-delete-dialog__irreversible svg {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.repository-delete-dialog__body :deep(.app-form-dialog__label) {
  font-size: inherit;
  line-height: inherit;
}

.repository-delete-dialog__delete {
  color: var(--color-on-error);
  border-color: var(--color-error);
  background: var(--color-error);
}
</style>
