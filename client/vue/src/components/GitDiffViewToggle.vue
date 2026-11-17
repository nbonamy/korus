<template>
  <AppSegmented v-model="view" class="git-diff-view-toggle" size="compact" :options="options" :label="$t('surface.diffTreemap.view')" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { translate } from '../i18n';
import { AffiliateIcon, ChartTreemapIcon, FileDiffIcon } from '../shared/icons/app-icons';
import AppSegmented from '../shared/AppSegmented.vue';
const view = defineModel<'diff' | 'viz' | 'map'>({ required: true });
const options = computed(() => [
  { value: 'diff', label: translate('surface.diffTreemap.files'), icon: FileDiffIcon },
  { value: 'viz', label: translate('surface.diffViz.name'), icon: AffiliateIcon },
  { value: 'map', label: translate('surface.diffTreemap.map'), icon: ChartTreemapIcon },
]);
</script>

<style scoped>
.git-diff-view-toggle {
  justify-self: center;
}
</style>
