<template>
  <div v-if="(showProvider && providers.length > 1) || showSource" class="backlog-source-selector" :class="{ 'backlog-source-selector--small': size === 'small', 'backlog-source-selector--full-width': fullWidth, 'backlog-source-selector--chip': chip }">
    <el-select v-if="showProvider && providers.length > 1" class="backlog-source-selector__provider" :size="size" :model-value="provider" :aria-label="$t('backlogSource.provider')" @update:model-value="emit('select-provider', $event)">
      <template #prefix><component :is="workProviderIcon(provider)" aria-hidden="true" /></template>
      <el-option v-for="option in providers" :key="option" :label="workProviderDefinition(option).label" :value="option">
        <span class="backlog-source-selector__option"><component :is="workProviderIcon(option)" aria-hidden="true" />{{ workProviderDefinition(option).label }}</span>
      </el-option>
    </el-select>
    <el-select v-if="showSource" class="backlog-source-selector__source" :size="size" :model-value="sourceId" filterable clearable :aria-label="$t(workProviderDefinition(provider).sourceLabel.key)" :placeholder="$t(workProviderDefinition(provider).sourceLabel.key)" @update:model-value="emit('select-source', $event || null)">
      <el-option v-for="source in sources" :key="source.id" :label="source.fullName" :value="source.id" />
    </el-select>
  </div>
</template>
<script setup lang="ts">
import type { WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import { workProviderDefinition } from '@workspace/core/work-providers';
import { workProviderIcon } from './work-provider-icons';
withDefaults(defineProps<{ provider: WorkProviderKind; providers: WorkProviderKind[]; sources?: WorkSource[]; sourceId?: string | null; showSource?: boolean; showProvider?: boolean; size?: 'default' | 'small'; fullWidth?: boolean; chip?: boolean }>(), { sources: () => [], sourceId: null, showSource: true, showProvider: true, size: 'default', fullWidth: false, chip: false });
const emit = defineEmits<{ 'select-provider': [provider: WorkProviderKind]; 'select-source': [id: string | null] }>();
</script>
<style scoped>
.backlog-source-selector {
  display: flex;
  gap: var(--space-4);
  min-width: 0;
}

.backlog-source-selector__provider {
  width: 110px;
  flex: 0 0 110px;
}

.backlog-source-selector__provider :deep(.el-select__wrapper) {
  padding: var(--space-3) var(--space-6);
}

.backlog-source-selector__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.backlog-source-selector__source {
  flex: 1;
  min-width: 0;
}

.backlog-source-selector--small .backlog-source-selector__provider {
  width: 96px;
  flex-basis: 96px;
}

/* Quiet inline trigger, like the sort chips: no border until hovered. */
.backlog-source-selector--chip .backlog-source-selector__provider {
  width: auto;
  flex: 0 0 auto;
}

.backlog-source-selector--chip .backlog-source-selector__provider :deep(.el-select__wrapper) {
  box-shadow: none;
  background: transparent;
  color: var(--color-text-muted);
}

.backlog-source-selector--chip .backlog-source-selector__provider :deep(.el-select__wrapper:hover),
.backlog-source-selector--chip .backlog-source-selector__provider :deep(.el-select__wrapper.is-focused) {
  box-shadow: none;
  color: var(--color-text);
  background: var(--color-surface-low);
}

.backlog-source-selector--full-width .backlog-source-selector__provider {
  width: 100%;
  flex: 1;
}
</style>
