<template>
  <section class="staged-operation-progress" :data-state="state" role="status">
    <header class="staged-operation-progress__heading">
      <span class="staged-operation-progress__icon">
        <CircleCheckIcon v-if="displayStep === steps.length" aria-hidden="true" />
        <CircleXIcon v-else-if="state === 'error'" aria-hidden="true" />
        <SparklesIcon v-else aria-hidden="true" />
      </span>
      <div>
        <span>{{ eyebrow }}</span>
        <strong>{{ displayTitle }}</strong>
      </div>
    </header>
    <p v-if="state === 'error' && errorDetail" class="staged-operation-progress__error-detail">
      {{ errorDetail }}
    </p>
    <ol>
      <li v-for="(step, index) in steps" :key="`${step.title}-${index}`" :class="stepClass(index)">
        <span class="staged-operation-progress__step-marker">
          <CheckIcon v-if="displayStep > index" aria-hidden="true" />
          <span v-else-if="displayStep === index && state !== 'error'" class="app-spinner app-spinner--sm" aria-hidden="true" />
          <CircleXIcon v-else-if="displayStep === index" aria-hidden="true" />
          <span v-else aria-hidden="true" />
        </span>
        <div>
          <strong>{{ step.title }}</strong>
          <small>{{ step.detail }}</small>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  IconCheck as CheckIcon,
  IconCircleCheck as CircleCheckIcon,
  IconCircleX as CircleXIcon,
  IconSparkles as SparklesIcon,
} from '@tabler/icons-vue';

export type StagedOperationStep = {
  title: string;
  detail: string;
};

const props = defineProps<{
  activeStep?: number;
  completeTitle: string;
  eyebrow: string;
  errorDetail?: string;
  errorTitle?: string;
  minimumDurationMs?: number;
  state: 'running' | 'success' | 'error';
  steps: StagedOperationStep[];
  title: string;
}>();

const emit = defineEmits<{
  complete: [];
}>();

const displayStep = ref(props.activeStep ?? 0);
const startedAt = Date.now();
let completionScheduled = false;
const timers: Array<ReturnType<typeof globalThis.setTimeout>> = [];
const displayTitle = computed(() => {
  if (props.state === 'error') return props.errorTitle ?? props.title;
  return displayStep.value === props.steps.length ? props.completeTitle : props.title;
});

if (props.activeStep === undefined) {
  for (let step = 1; step < props.steps.length; step += 1) {
    timers.push(globalThis.setTimeout(() => {
      displayStep.value = Math.min(step, props.steps.length);
    }, 1_100 + ((step - 1) * 1_700)));
  }
}

watch(() => props.activeStep, (activeStep) => {
  if (activeStep !== undefined && props.state !== 'success') {
    displayStep.value = Math.min(activeStep, props.steps.length);
  }
});

watch(() => props.state, (state) => {
  if (state === 'success') finish();
  if (state === 'error') clearTimers();
}, { immediate: true });

onBeforeUnmount(clearTimers);

function finish(): void {
  if (completionScheduled) return;
  completionScheduled = true;
  clearTimers();
  const minimumDuration = props.minimumDurationMs
    ?? 3_800 + (Math.max(0, props.steps.length - 3) * 1_700);
  timers.push(globalThis.setTimeout(() => {
    displayStep.value = props.steps.length;
    timers.push(globalThis.setTimeout(() => emit('complete'), 600));
  }, props.activeStep === undefined ? Math.max(0, minimumDuration - (Date.now() - startedAt)) : 0));
}

function stepClass(index: number): string {
  if (displayStep.value > index) return 'is-complete';
  if (displayStep.value === index) return props.state === 'error' ? 'is-error' : 'is-active';
  return 'is-pending';
}

function clearTimers(): void {
  timers.splice(0).forEach((timer) => globalThis.clearTimeout(timer));
}
</script>

<style scoped>
.staged-operation-progress {
  min-height: 280px;
  display: grid;
  align-content: center;
  gap: var(--space-8);
  padding: var(--space-8);
}

.staged-operation-progress__heading {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.staged-operation-progress__heading > div {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.staged-operation-progress__heading > div > span {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.staged-operation-progress__heading strong {
  font-size: var(--font-size-16);
  line-height: var(--line-height-22);
}

.staged-operation-progress__icon {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-xl);
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.staged-operation-progress__icon svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.staged-operation-progress__error-detail {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
}

.staged-operation-progress[data-state="success"]
  .staged-operation-progress__icon {
  color: var(--color-success);
  background: var(--color-success-container);
}

.staged-operation-progress[data-state="error"]
  .staged-operation-progress__icon {
  color: var(--color-error);
  background: var(--color-error-container);
}

.staged-operation-progress ol {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.staged-operation-progress li {
  min-height: 52px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  transition:
    opacity 180ms ease,
    background-color 180ms ease;
}

.staged-operation-progress li.is-active {
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.staged-operation-progress li.is-error {
  background: color-mix(in srgb, var(--color-error) 8%, transparent);
}

.staged-operation-progress li.is-pending {
  opacity: 0.42;
}

.staged-operation-progress li > div {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}

.staged-operation-progress li strong,
.staged-operation-progress li small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staged-operation-progress li strong {
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-semibold);
}

.staged-operation-progress li small {
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

.staged-operation-progress__step-marker {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}

.staged-operation-progress li.is-error .staged-operation-progress__step-marker {
  color: var(--color-error);
}

.staged-operation-progress__step-marker svg {
  width: var(--icon-md);
  height: var(--icon-md);
}

.staged-operation-progress__step-marker > span:not(.app-spinner) {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .staged-operation-progress li {
    transition-duration: 1ms;
  }
}
</style>
