<template>
  <AppMenuButton :ariaLabel="t('split.layout')" :items="items" @select="select">
    <template #trigger="{ attrs }">
      <button
        v-bind="attrs"
        type="button"
        class="split-layout-control"
        :aria-label="t('split.layout')"
        :title="t('split.layout')"
      >
        <component :is="icons[layouts.indexOf(modelValue)]" aria-hidden="true" />
      </button>
    </template>
  </AppMenuButton>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  IconLayoutGrid,
  IconLayoutColumns,
  IconLayoutRows,
  IconLayoutNavbar,
} from '@tabler/icons-vue';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import type { SplitLayout } from './use-split-workspace';
const props = defineProps<{ modelValue: SplitLayout }>();
const emit = defineEmits<{ 'update:modelValue': [layout: SplitLayout] }>();
const { t } = useI18n();
const layouts = ['single', '2-vertical', '2-horizontal', '4-quadrant'] as const;
const icons = [IconLayoutNavbar, IconLayoutColumns, IconLayoutRows, IconLayoutGrid];
const items = computed<AppMenuItem[]>(() =>
  layouts.map((id, index) => ({
    id,
    type: 'radio',
    label: t(`split.${id}`),
    icon: icons[index],
    checked: props.modelValue === id,
  })),
);
function select(id: string): void {
  if (layouts.includes(id as SplitLayout))
    emit('update:modelValue', id as SplitLayout);
}
</script>
<style scoped>
.split-layout-control {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.split-layout-control:hover,
.split-layout-control:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-high);
}
.split-layout-control svg {
  width: 18px;
  height: 18px;
}
</style>
