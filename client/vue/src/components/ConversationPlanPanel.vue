<template>
  <aside class="conversation-plan" aria-live="polite" :aria-label="t('chat.planProgress.title')">
    <header class="conversation-plan__header">
      <h2 :title="planTitle">{{ planTitle }}</h2>
      <button
        class="conversation-plan__close"
        type="button"
        :aria-label="t('chat.planProgress.close')"
        :title="t('chat.planProgress.close')"
        @click="emit('close')"
      >
        <X :size="16" stroke-width="1.8" aria-hidden="true" />
      </button>
    </header>
    <ol class="conversation-plan__steps">
      <li
        v-for="(entry, index) in plan.steps"
        :key="`${index}:${entry.step}`"
        class="conversation-plan__step"
        :class="`conversation-plan__step--${entry.status}`"
      >
        <CircleCheckIcon
          v-if="entry.status === 'completed'"
          class="conversation-plan__status-icon"
          :size="16"
          stroke-width="1.8"
          aria-hidden="true"
        />
        <LoaderIcon v-else-if="entry.status === 'inProgress' && running" class="conversation-plan__status-icon conversation-plan__working" :size="16" stroke-width="1.8" aria-hidden="true" />
        <Circle v-else class="conversation-plan__status-icon conversation-plan__pending" :size="16" stroke-width="1.8" aria-hidden="true" />
        <span class="conversation-plan__step-label">{{ entry.step }}</span>
        <span class="conversation-plan__sr-only">
          {{ t(`chat.planProgress.status.${entry.status}`) }}
        </span>
      </li>
    </ol>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ThreadPlan } from '@workspace/core/contracts';
import { Circle, CircleCheckIcon, LoaderIcon, X } from '../shared/icons/app-icons';

const props = defineProps<{
  plan: ThreadPlan;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const planTitle = computed(() => props.plan.explanation?.trim() || t('chat.planProgress.title'));
const running = computed(() => props.plan.status === 'inProgress');
</script>

<style scoped>
.conversation-plan {
  position: absolute;
  z-index: 2;
  top: var(--space-6);
  right: var(--space-20);
  box-sizing: border-box;
  width: min(280px, calc(100% - var(--space-24)));
  max-height: min(42%, 360px);
  overflow: auto;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  color: var(--color-text-muted);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}

.conversation-plan__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-1) var(--space-4);
}

.conversation-plan__header h2 {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-plan__close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.conversation-plan__close:hover {
  color: var(--color-text);
  background: var(--color-surface-high);
}

.conversation-plan__close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.conversation-plan__steps {
  display: grid;
  gap: 10px;
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.conversation-plan__step {
  display: grid;
  grid-template-columns: var(--icon-md) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-4);
  padding-inline: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.conversation-plan__step--inProgress {
  color: var(--color-text);
}

.conversation-plan__step--completed {
  color: var(--color-text-muted);
}

.conversation-plan__step--completed .conversation-plan__step-label {
  text-decoration: line-through;
}

.conversation-plan__status-icon {
  width: var(--icon-md);
  height: var(--icon-md);
  margin-top: 1px;
}

.conversation-plan__working {
  animation: app-spin 6s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .conversation-plan__working {
    animation: none;
  }
}

.conversation-plan__pending {
  color: var(--color-border-strong);
  stroke-dasharray: 2 3;
}

.conversation-plan__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
