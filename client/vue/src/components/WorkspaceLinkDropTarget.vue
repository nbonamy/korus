<template>
  <div class="workspace-link-drop-target" :aria-label="$t('surface.rightWorkspacePanel.dropLink')">
    <span>{{ $t('surface.rightWorkspacePanel.dropLink') }}</span>
  </div>
</template>

<style scoped>
.workspace-link-drop-target {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-shell-main) 92%, transparent);
  box-shadow: inset 0 0 0 2px var(--color-primary);
  pointer-events: auto;
}
</style>
