<template>
  <div class="form-grid" :class="`form-grid--${columns}`">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ columns?: 1 | 2 | 3 }>(), { columns: 2 });
</script>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-6);
  padding: var(--space-6);
}

.form-grid--1 {
  grid-template-columns: minmax(0, 1fr);
}

.form-grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .form-grid--3 {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
