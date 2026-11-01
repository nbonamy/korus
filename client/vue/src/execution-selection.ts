import { computed, ref, type Ref } from 'vue';
import type { ExecutionSelection } from '@workspace/core/contracts/execution';
import { defaultExecutionSelection } from '@workspace/core/execution-selection';

/** Form controls edit one execution value; callers submit that value intact. */
export function useExecutionSelection(initial?: ExecutionSelection) {
  const selection = ref<ExecutionSelection | undefined>(initial);
  return executionSelectionControls(selection);
}

export function executionSelectionControls(selection: Ref<ExecutionSelection | undefined>) {
  const backend = computed({
    get: () => selection.value?.backend,
    set: (value: ExecutionSelection['backend'] | undefined) => {
      selection.value = value ? { ...(selection.value ?? defaultExecutionSelection(value)), backend: value } : undefined;
    },
  });
  const field = (key: 'model' | 'reasoningEffort' | 'serviceTier') => computed({
    get: () => selection.value?.[key] ?? '',
    set: (value: string) => { if (selection.value) selection.value = { ...selection.value, [key]: value || null }; },
  });
  return { selection, backend, model: field('model'), reasoningEffort: field('reasoningEffort'), serviceTier: field('serviceTier') };
}
