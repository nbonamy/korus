<template>
  <QuickOpenDialog
    :dialog-label="$t('surface.fileQuickOpen.openWorkspaceFile')"
    :empty-label="$t('surface.fileQuickOpen.noMatchingFiles')"
    :input-aria-label="$t('surface.fileQuickOpen.quickOpenWorkspaceFile')"
    :items="items"
    :placeholder="$t('surface.fileQuickOpen.openFile')"
    @close="emit('close')"
    @select="emit('select', $event)"
  >
    <template #item="{ item }">
      <FileTextIcon aria-hidden="true" />
      <span>{{ item.label }}</span>
      <small>{{ item.detail }}</small>
    </template>
  </QuickOpenDialog>
</template>

<script setup lang="ts">
import type { AgentFileSearchItem } from '@workspace/core/contracts';
import { computed } from 'vue';
import { FileTextIcon } from '../shared/icons/app-icons';
import QuickOpenDialog from '../shared/QuickOpenDialog.vue';

const props = defineProps<{ files: AgentFileSearchItem[] }>();
const emit = defineEmits<{ close: []; select: [path: string] }>();
const items = computed(() => props.files.map((file) => ({
  id: file.path,
  label: file.name,
  detail: file.path,
  searchText: file.path,
})));
</script>

<style scoped>
:deep(.quick-open-dialog__item) {
  display: grid;
  grid-template-columns: var(--icon-md) minmax(80px, auto) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
}

:deep(.quick-open-dialog__item svg) {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

:deep(.quick-open-dialog__item span),
:deep(.quick-open-dialog__item small) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.quick-open-dialog__item small) {
  color: var(--color-text-muted);
}
</style>
