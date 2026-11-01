import { computed, ref } from 'vue';
import type { WorkspaceProvisioningOperation } from './WorkspaceProvisioningProgressDialog.vue';

type OperationHandlers = {
  onClose?: (id: string) => void;
  onBackground?: (id: string) => void;
};
type OperationEntry = { source: string; operation: WorkspaceProvisioningOperation; handlers: OperationHandlers };

// Every flow that provisions workspaces publishes here; one dialog renders whatever is active.
const entries = ref<OperationEntry[]>([]);
const backgroundedIds = ref(new Set<string>());

export function provisioningOperationIds(operation: WorkspaceProvisioningOperation): string[] {
  if (operation.mode === 'batch') return operation.progress.map((entry) => entry.id);
  return [operation.mode === 'multiple' ? operation.id : operation.progress.id];
}

function operationState(operation: WorkspaceProvisioningOperation): 'running' | 'success' | 'error' {
  if (operation.mode === 'multiple') return operation.state;
  if (operation.mode === 'batch') {
    if (operation.progress.some((entry) => entry.state === 'running')) return 'running';
    return operation.progress.some((entry) => entry.state === 'error') ? 'error' : 'success';
  }
  return operation.progress.state;
}

/** Replaces what a source is showing; `null` removes it. */
export function publishProvisioningOperation(
  source: string,
  operation: WorkspaceProvisioningOperation | null,
  handlers: OperationHandlers = {},
): void {
  const index = entries.value.findIndex((entry) => entry.source === source);
  if (!operation) {
    if (index >= 0) entries.value = entries.value.filter((entry) => entry.source !== source);
  } else if (index >= 0) {
    entries.value = entries.value.map((entry, position) => position === index ? { source, operation, handlers } : entry);
  } else {
    entries.value = [...entries.value, { source, operation, handlers }];
  }
  const live = new Set(entries.value.flatMap((entry) => provisioningOperationIds(entry.operation)));
  const kept = [...backgroundedIds.value].filter((id) => live.has(id));
  if (kept.length !== backgroundedIds.value.size) backgroundedIds.value = new Set(kept);
}

export function isProvisioningBackgrounded(id: string): boolean {
  return backgroundedIds.value.has(id);
}

// A backgrounded operation stays out of sight unless it fails.
const activeEntry = computed(() => entries.value.find((entry) => {
  const ids = provisioningOperationIds(entry.operation);
  return !(ids.every((id) => backgroundedIds.value.has(id)) && operationState(entry.operation) !== 'error');
}) ?? null);

export const activeProvisioningOperation = computed(() => activeEntry.value?.operation ?? null);

export function closeProvisioningOperation(id: string): void {
  activeEntry.value?.handlers.onClose?.(id);
}

export function backgroundProvisioningOperation(id: string): void {
  const entry = activeEntry.value;
  if (!entry) return;
  backgroundedIds.value = new Set([...backgroundedIds.value, id]);
  entry.handlers.onBackground?.(id);
}

export function resetProvisioningOperations(): void {
  entries.value = [];
  backgroundedIds.value = new Set();
}
