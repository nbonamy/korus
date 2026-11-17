<template>
  <button class="sidebar-expand-button agent-ui-interactive" type="button" :aria-label="label" :title="label" @click="emit('click')">
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
  --agent-ui-state-rest-foreground: var(--color-text-muted);
  -webkit-app-region: no-drag;
}

.sidebar-expand-button svg {
  width: var(--icon-md);
  height: var(--icon-md);
}
</style>
