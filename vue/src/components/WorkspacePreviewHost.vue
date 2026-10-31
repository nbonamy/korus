<template>
  <el-dialog v-if="dialog" class="app-dialog mission-document-dialog" :model-value="open" :title="title || t('missions.documentPreview')"
    :close-on-click-modal="false" :show-close="false" align-center append-to-body width="min(720px, calc(100vw - 48px))"
    @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="workspace-preview-host__header">
        <h2 class="app-dialog__title">{{ title || t('missions.documentPreview') }}</h2>
        <button type="button" class="app-icon-button" :aria-label="t('missions.closeDocument')" @click="emit('close')"><X aria-hidden="true" /></button>
      </div>
    </template>
    <div class="workspace-preview-host__body"><slot /></div>
  </el-dialog>
  <slot v-else />
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { X } from '../shared/icons/app-icons';
defineProps<{ dialog?: boolean; open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
</script>
<style scoped>
.workspace-preview-host__header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); }
.workspace-preview-host__header h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-preview-host__body { display: flex; height: min(75vh, 800px); min-height: 160px; min-width: 0; }
</style>
