<template>
  <el-segmented v-model="view" class="git-diff-view-toggle" :options="options" :aria-label="$t('surface.diffTreemap.view')">
    <template #default="{ item }">
      <span class="git-diff-view-toggle__option">
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </span>
    </template>
  </el-segmented>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { translate } from '../i18n';
import { AffiliateIcon, ChartTreemapIcon, FileDiffIcon } from '../shared/icons/app-icons';
const view = defineModel<'diff' | 'viz' | 'map'>({ required: true });
const options = computed(() => [
  { value: 'diff', label: translate('surface.diffTreemap.files'), icon: FileDiffIcon },
  { value: 'viz', label: translate('surface.diffViz.name'), icon: AffiliateIcon },
  { value: 'map', label: translate('surface.diffTreemap.map'), icon: ChartTreemapIcon },
]);
</script>

<style scoped>
.git-diff-view-toggle {
  --el-segmented-padding: var(--space-1);
  --el-segmented-bg-color: color-mix(in srgb, var(--color-text) 6%, transparent);
  justify-self: center;
  font-weight: var(--font-weight-semibold);
}
.git-diff-view-toggle :deep(.el-segmented__item) { padding: var(--space-2) var(--space-6); }
.git-diff-view-toggle :deep(.el-segmented__item-selected) { box-shadow: var(--shadow-sm); }
.git-diff-view-toggle__option { display: flex; align-items: center; gap: var(--space-3); }
.git-diff-view-toggle__option svg { width: var(--icon-md); height: var(--icon-md); }
</style>
