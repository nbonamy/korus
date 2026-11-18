<template>
  <Transition :name="fade ? 'pane-collapse' : 'pane-collapse-solid'" :css="enabled"><slot /></Transition>
</template>

<script setup lang="ts">
/** `fade: false` is for translucent panes: fading them would show the window material behind, not the theme. */
withDefaults(defineProps<{ enabled?: boolean; fade?: boolean }>(), { enabled: true, fade: true });
</script>

<style>
.pane-collapse-enter-active,
.pane-collapse-leave-active,
.pane-collapse-solid-enter-active,
.pane-collapse-solid-leave-active {
  overflow: hidden;
  min-width: 0 !important;
  flex-grow: 0 !important;
  flex-shrink: 0 !important;
  transition-property: flex-basis, width, opacity;
  transition-duration: 0.28s;
  transition-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.pane-collapse-solid-enter-active,
.pane-collapse-solid-leave-active {
  transition-property: flex-basis, width;
}

.pane-collapse-enter-from,
.pane-collapse-leave-to,
.pane-collapse-solid-enter-from,
.pane-collapse-solid-leave-to {
  flex-basis: 0 !important;
  width: 0 !important;
}

.pane-collapse-enter-from,
.pane-collapse-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pane-collapse-enter-active,
  .pane-collapse-leave-active,
  .pane-collapse-solid-enter-active,
  .pane-collapse-solid-leave-active {
    transition: none;
  }
}
</style>
