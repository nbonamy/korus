<template>
  <figure>
    <figcaption>{{ exhibit.title }}</figcaption>
    <div v-if="exhibit.screens" class="mockup-screens" role="group" :aria-label="exhibit.text">
      <InteractivePlanMockup v-for="(screen, index) in exhibit.screens" :key="index" :screen="screen" />
    </div>
    <pre v-else>{{ exhibit.text }}</pre>
  </figure>
</template>

<script setup lang="ts">
import type { PlanSection } from '@workspace/core/interactive-plan';
import InteractivePlanMockup from './InteractivePlanMockup.vue';
defineProps<{ exhibit: NonNullable<PlanSection['exhibit']> }>();
</script>

<style scoped>
figure {
  margin: 0 0 18px;
}
figcaption {
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
  margin-bottom: 12px;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
  border: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  border-radius: 7px;
  padding: 14px;
  font:
    12px/1.65 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  max-height: 320px;
  overflow: auto;
}
.mockup-screens {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 16px;
}
</style>
