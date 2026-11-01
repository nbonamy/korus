<template>
  <button class="sidebar-expand-button" type="button" :aria-label="label" :title="label" @click="emit('click')">
    <PanelLeftOpenIcon aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { PanelLeftOpenIcon } from './icons/app-icons';

defineProps<{ label: string }>();
const emit = defineEmits<{ click: [] }>();
</script>

<style scoped>
.sidebar-expand-button {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 0;
  border: none;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.sidebar-expand-button svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
