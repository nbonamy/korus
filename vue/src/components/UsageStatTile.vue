<template>
  <UsageCard as="article" class="usage-stat">
    <span class="usage-stat__label">{{ label }}</span>
    <strong v-if="value !== undefined" class="usage-stat__value">{{
      value
    }}</strong>
    <UsageSparkline
      v-if="spark"
      class="usage-stat__spark"
      :style="{ color: sparkColor }"
      :values="spark"
    />
    <slot />
  </UsageCard>
</template>
<script setup lang="ts">
import UsageCard from "./UsageCard.vue";
import UsageSparkline from "./UsageSparkline.vue";
defineProps<{
  label: string;
  value?: string;
  spark?: number[];
  sparkColor?: string;
}>();
</script>
<style scoped>
.usage-stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow: hidden;
}
.usage-stat__label {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
}
.usage-stat__value {
  font-size: var(--font-size-28);
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.02em;
  line-height: var(--line-height-32);
  white-space: nowrap;
}
.usage-stat__spark {
  margin-top: var(--space-6);
}
</style>
