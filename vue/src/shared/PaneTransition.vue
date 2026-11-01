<template>
  <Transition name="pane-collapse"><slot /></Transition>
</template>

<style>
.pane-collapse-enter-active,
.pane-collapse-leave-active {
  overflow: hidden;
  min-width: 0 !important;
  transition-property: flex-basis, width, opacity;
  transition-duration: 0.28s;
  transition-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.pane-collapse-enter-from,
.pane-collapse-leave-to {
  flex-basis: 0 !important;
  width: 0 !important;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pane-collapse-enter-active,
  .pane-collapse-leave-active {
    transition: none;
  }
}
</style>
