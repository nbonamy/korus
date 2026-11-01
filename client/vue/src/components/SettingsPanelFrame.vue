<template>
  <section
    class="settings-panel"
    :aria-labelledby="titleId"
  >
    <header class="settings-panel__header">
      <h2 :id="titleId">{{ title }}</h2>
      <div
        v-if="$slots.actions"
        class="settings-panel__actions"
      >
        <slot name="actions" />
      </div>
    </header>
    <div
      v-if="$slots.banner"
      class="settings-panel__banner"
    >
      <slot name="banner" />
    </div>
    <div class="settings-panel__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  titleId: string;
}>();
</script>

<style scoped>
.settings-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
}

.settings-panel__header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-12);
  align-items: flex-end;
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.settings-panel__header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-18);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
}

.settings-panel__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-6);
}

.settings-panel__body {
  min-width: 0;
}

.settings-panel__banner {
  min-width: 0;
  margin-bottom: var(--space-8);
}
</style>
