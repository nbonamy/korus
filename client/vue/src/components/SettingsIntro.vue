<template>
  <div class="settings-intro">
    <slot>
      <SettingsIllustration v-if="kind" :kind="kind" />
    </slot>
    <div class="settings-intro__copy">
      <strong>{{ title }}</strong>
      <span>{{ description }}</span>
    </div>
    <div v-if="$slots.action" class="settings-intro__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import SettingsIllustration from './SettingsIllustration.vue';
import type { SettingsIllustrationKind } from './settings-illustration';

defineProps<{ kind?: SettingsIllustrationKind; title: string; description: string }>();
</script>

<style scoped>
.settings-intro {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-8) var(--space-12);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-card-background);
}

.settings-intro :slotted(.backend-icon.settings-intro-logo) {
  width: var(--space-20) !important;
  height: var(--space-20) !important;
  color: var(--color-text);
}

.settings-intro__action {
  flex: 0 0 auto;
  margin-left: auto;
}

.settings-intro__copy {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.settings-intro__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-22);
}

.settings-intro__copy span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}
</style>
