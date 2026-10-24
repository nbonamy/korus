<template>
  <component
    :is="as"
    class="form-row"
    :class="{ 'form-row--leading': $slots.leading }"
  >
    <span v-if="$slots.leading" class="form-row__leading"><slot name="leading" /></span>
    <span class="form-row__copy">
      <strong>{{ title }}</strong>
      <span v-if="description">{{ description }}</span>
      <span
        v-if="error"
        class="form-row__error"
      >
        {{ error }}
      </span>
      <slot name="copy" />
    </span>
    <span
      v-if="$slots.control"
      class="form-row__control"
    >
      <slot name="control" />
    </span>
  </component>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  as?: 'article' | 'div' | 'label';
  description?: string;
  error?: string | null;
  title: string;
}>(), {
  as: 'article',
  description: '',
  error: null,
});
</script>

<style scoped>
.form-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, auto);
  align-items: center;
  gap: var(--space-16);
  padding: var(--space-8);
}

.form-row__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.form-row--leading {
  grid-template-columns: auto minmax(0, 1fr) minmax(220px, auto);
  padding-inline: var(--space-16);
}

.form-row__leading {
  display: flex;
  align-items: center;
}

.form-row__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
}

.form-row__copy span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.form-row__copy .form-row__error {
  color: var(--color-danger, #c2410c);
}

.form-row__control {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  justify-content: flex-end;
  gap: var(--space-8);
}

@media (max-width: 780px) {
  .form-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .form-row--leading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .form-row--leading .form-row__control {
    grid-column: 2;
  }

  .form-row__control {
    justify-self: start;
  }
}
</style>
