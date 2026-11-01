<template>
  <header class="workspace-header" :class="{ 'workspace-header--sidebar-collapsed': sidebarCollapsed }">
    <slot />
  </header>
</template>

<script setup lang="ts">
defineProps<{ sidebarCollapsed?: boolean }>();
</script>

<style scoped>
.workspace-header {
  position: relative;
  z-index: 5;
  display: flex;
  flex: 0 0 var(--workbench-appbar-height);
  min-height: var(--workbench-appbar-height);
  min-width: 0;
  align-items: center;
  gap: var(--space-8);
  padding: 0 var(--space-4) 0 var(--space-8);
  border-bottom: 1px solid var(--color-shell-appbar-divider);
  background: var(--color-shell-main);
  box-shadow: var(--shadow-content-edge);
  user-select: none;
  -webkit-app-region: drag;
}

.workspace-header--sidebar-collapsed {
  padding-left: var(--space-16);
  box-shadow: none;
}

.workspace-header :deep(.workspace-header__title) {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--color-text);
  font: inherit;
  font-weight: var(--font-weight-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
