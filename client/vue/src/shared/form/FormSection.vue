<template>
  <section
    class="form-section"
    :class="{ 'form-section--compact': density === 'compact' }"
    :aria-labelledby="title ? titleId : undefined"
  >
    <header
      v-if="title"
      class="form-section__header"
    >
      <h3 :id="titleId" class="app-section-label">{{ title }}</h3>
      <div v-if="$slots.actions" class="form-section__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="form-section__group">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
  titleId?: string;
  density?: 'default' | 'compact';
}>();
</script>

<style scoped>
.form-section {
  min-width: 0;
}

.form-section + .form-section {
  margin-top: var(--space-24);
}

.form-section__header {
  min-height: var(--space-10);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  padding: 0 0 var(--space-4);
}

.form-section__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
}

.form-section__group {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-card-background);
}

.form-section__group :deep(.form-row + .form-row) {
  border-top: 1px solid var(--color-border);
}

.form-section--compact .form-section__header {
  padding-bottom: var(--space-4);
}

.form-section--compact + .form-section--compact {
  margin-top: var(--space-12);
}

.form-section--compact .form-section__group :deep(.form-row) {
  gap: var(--space-4);
  padding: var(--space-6);
}
</style>
