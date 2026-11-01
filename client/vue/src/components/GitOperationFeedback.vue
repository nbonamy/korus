<template>
  <div
    class="git-operation-feedback"
    :class="`git-operation-feedback--${status}`"
    role="status"
    aria-live="polite"
    :aria-busy="status === 'running'"
  >
    <div class="git-operation-feedback__mark" aria-hidden="true">
      <span v-if="status === 'running'" class="git-operation-feedback__orbit" />
      <slot v-if="status === 'running'" name="icon" />
      <CheckIcon v-else-if="status === 'success'" />
      <AlertTriangleIcon v-else-if="status === 'warning'" />
      <CircleXIcon v-else />
    </div>
    <div class="git-operation-feedback__copy">
      <strong>{{ title }}</strong>
      <span v-if="detail">{{ detail }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangleIcon, CheckIcon, CircleXIcon } from '../shared/icons/app-icons';

defineProps<{
  status: 'running' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}>();

defineSlots<{
  icon?: () => unknown;
}>();
</script>

<style scoped>
.git-operation-feedback {
  display: grid;
  min-height: 220px;
  place-content: center;
  justify-items: center;
  gap: var(--space-6);
  color: var(--color-primary);
  text-align: center;
}

.git-operation-feedback--success {
  color: var(--color-success);
}

.git-operation-feedback--error {
  color: var(--color-error);
}

.git-operation-feedback--warning {
  color: var(--color-warning);
}

.git-operation-feedback__mark {
  position: relative;
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, currentColor 10%, transparent);
}

.git-operation-feedback__mark::after {
  position: absolute;
  inset: 0;
  border: 1px solid currentColor;
  border-radius: inherit;
  content: "";
  opacity: 0;
}

.git-operation-feedback--success .git-operation-feedback__mark {
  animation: git-operation-feedback-arrive 220ms ease-out both;
}

.git-operation-feedback--success .git-operation-feedback__mark::after {
  animation: git-operation-feedback-bloom 700ms ease-out 80ms both;
}

.git-operation-feedback__mark svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  stroke-width: 2.25;
}

.git-operation-feedback__orbit {
  position: absolute;
  inset: -1px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: color-mix(in srgb, currentColor 35%, transparent);
  border-radius: inherit;
  animation: git-operation-feedback-spin 850ms linear infinite;
}

.git-operation-feedback__copy {
  display: grid;
  max-width: 380px;
  gap: var(--space-2);
}

.git-operation-feedback__copy strong {
  color: var(--color-text);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-24);
}

.git-operation-feedback__copy span {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

@keyframes git-operation-feedback-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes git-operation-feedback-arrive {
  from {
    opacity: 0;
    transform: scale(0.72);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes git-operation-feedback-bloom {
  from {
    opacity: 0.45;
    transform: scale(0.9);
  }

  to {
    opacity: 0;
    transform: scale(1.55);
  }
}

@media (prefers-reduced-motion: reduce) {
  .git-operation-feedback__orbit {
    animation-duration: 1.8s;
  }

  .git-operation-feedback--success .git-operation-feedback__mark,
  .git-operation-feedback--success .git-operation-feedback__mark::after {
    animation: none;
  }
}
</style>
