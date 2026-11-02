<template>
  <el-segmented v-model="view" class="git-diff-view-toggle" :options="options" :aria-label="$t('surface.diffTreemap.view')" size="small">
    <template #default="{ item }">
      <el-tooltip :content="item.label" placement="top" :show-after="500">
        <span class="git-diff-view-toggle__option">
          <component :is="item.value === 'map' ? ChartTreemapIcon : FileDiffIcon" aria-hidden="true" />
          <span class="git-diff-view-toggle__label">{{ item.label }}</span>
        </span>
      </el-tooltip>
    </template>
  </el-segmented>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { translate } from '../i18n';
import { ChartTreemapIcon, FileDiffIcon } from '../shared/icons/app-icons';
const view = defineModel<'diff' | 'map'>({ required: true });
const options = computed(() => [
  { value: 'diff', label: translate('surface.diffTreemap.files') },
  { value: 'map', label: translate('surface.diffTreemap.map') },
]);
</script>

<style scoped>
.git-diff-view-toggle {
  --el-segmented-padding: var(--space-1);
  --el-segmented-bg-color: transparent;
  --el-segmented-item-selected-bg-color: var(--color-primary);
  --el-segmented-item-selected-color: var(--color-on-primary);
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.git-diff-view-toggle :deep(.el-segmented__item),
.git-diff-view-toggle :deep(.el-segmented__item-selected) { border-radius: var(--radius-sm); }
.git-diff-view-toggle :deep(.el-segmented__item-selected) { box-shadow: none; }
.git-diff-view-toggle :deep(.el-segmented__item) { padding: var(--space-2) var(--space-6); }
.git-diff-view-toggle__option { display: grid; place-items: center; min-width: var(--icon-md); min-height: var(--icon-md); }
.git-diff-view-toggle__option svg { width: var(--icon-md); height: var(--icon-md); }
.git-diff-view-toggle__label { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
