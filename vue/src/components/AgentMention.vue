<template>
  <span class="agent-mention" :class="`agent-mention--${surface}`">
    <RobotFaceIcon class="agent-mention__icon" aria-hidden="true" />
    <strong v-if="surface === 'menu'" class="agent-mention__label">{{ label }}</strong>
    <span v-else class="agent-mention__label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { RobotFaceIcon } from '../shared/icons/app-icons';

defineProps<{
  label: string;
  surface: 'composer' | 'menu' | 'message';
}>();
</script>

<style scoped>
.agent-mention {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.agent-mention--menu {
  width: 100%;
  gap: var(--space-8);
}

.agent-mention--composer,
.agent-mention--message {
  max-width: 220px;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  font-size: var(--font-size-13);
  line-height: 1.2;
  vertical-align: baseline;
  user-select: all;
}

.agent-mention__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 var(--icon-sm);
}

.agent-mention--message {
  vertical-align: -2px;
}

.agent-mention--menu .agent-mention__icon {
  width: var(--icon-md);
  height: var(--icon-md);
  flex-basis: var(--icon-md);
}

.agent-mention__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
