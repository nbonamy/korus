<template>
    <div v-if="visibleWorktreeInitialization" class="conversation-pane__initialization" role="status" aria-live="polite">
      <span v-if="visibleWorktreeInitialization.state === 'running'" class="app-spinner app-spinner--sm" aria-hidden="true" />
      <span v-else-if="visibleWorktreeInitialization.state === 'complete'" class="conversation-pane__initialization-check" aria-hidden="true"><IconCheck /></span>
      <div>
        <strong>{{ t(visibleWorktreeInitialization.state === 'running' ? 'worktreeInitialization.running' : visibleWorktreeInitialization.state === 'complete' ? 'worktreeInitialization.complete' : 'worktreeInitialization.failed') }}</strong>
        <small :title="visibleWorktreeInitialization.error ?? visibleWorktreeInitialization.command ?? initializationCommand">{{ visibleWorktreeInitialization.error ?? visibleWorktreeInitialization.command ?? (initializationCommand || t('worktreeInitialization.preparing')) }}</small>
      </div>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconCheck } from '@tabler/icons-vue';
import type { Agent } from '@workspace/core/contracts';
import { worktreeInitializationPreviewKey } from './debug-worktree-initialization';

const props = defineProps<{ agent: Pick<Agent, 'id' | 'folder' | 'worktreeInitialization'> | null }>();
const { t } = useI18n();

const preview = inject(worktreeInitializationPreviewKey, null);
const displayedAgent = computed(() => {
  const fixture = preview?.value;
  return fixture && fixture.id === props.agent?.id && fixture.folder === props.agent.folder
    && props.agent.worktreeInitialization?.state !== 'running' ? fixture : props.agent;
});

const initializationDone = ref(false);
const initializationCommand = ref('');
let initializationTimer: ReturnType<typeof setTimeout> | undefined;
watch([
  () => displayedAgent.value?.id,
  () => displayedAgent.value?.folder,
  () => displayedAgent.value?.worktreeInitialization?.state,
  () => displayedAgent.value?.worktreeInitialization?.command,
], ([id, folder, state, command], [previousId, previousFolder, previousState]) => {
  clearTimeout(initializationTimer);
  const sameAgent = id === previousId && folder === previousFolder;
  if (!sameAgent || (state === 'running' && previousState !== 'running')) initializationCommand.value = command ?? '';
  else if (command !== undefined) initializationCommand.value = command;
  initializationDone.value = sameAgent && previousState === 'running' && state === 'complete';
  if (initializationDone.value) initializationTimer = setTimeout(() => { initializationDone.value = false; }, 1_000);
}, { immediate: true });
onScopeDispose(() => clearTimeout(initializationTimer));
const visibleWorktreeInitialization = computed(() => {
  const state = displayedAgent.value?.worktreeInitialization;
  return state && (state.state !== 'complete' || initializationDone.value) ? state : null;
});

</script>

<style scoped>
.conversation-pane__initialization {
  position: absolute;
  top: var(--space-8);
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-6);
  max-width: calc(100% - var(--space-16));
  padding: var(--space-2) var(--space-8);
  background: var(--color-shell-main);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.conversation-pane__initialization > div {
  display: grid;
  gap: 0;
  min-width: 0;
}

.conversation-pane__initialization > .app-spinner {
  flex-shrink: 0;
}

.conversation-pane__initialization-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--color-success);
}

.conversation-pane__initialization-check svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.conversation-pane__initialization strong {
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  font-weight: var(--font-weight-bold);
}

.conversation-pane__initialization small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
  font-weight: var(--font-weight-regular);
  color: var(--color-text-muted);
}

</style>
