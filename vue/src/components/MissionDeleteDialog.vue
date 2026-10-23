<template>
  <el-dialog
    class="app-dialog mission-delete-dialog"
    :model-value="visible"
    :teleported="false"
    width="560px"
    :show-close="false"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-form-dialog__header">
        <h2 class="app-dialog__title">{{ t('missions.deleteTitle', { mission: mission?.outcome }) }}</h2>
      </div>
    </template>

    <div class="mission-delete-dialog__body">
      <p>{{ t(mission?.execution?.debugFixture ? 'missions.deleteDebugDescription' : 'missions.deleteDescription') }}</p>
      <template v-if="worktrees.length">
        <p>{{ t(worktrees.length === 1 ? 'missions.deleteWorktreeChoice' : 'missions.deleteWorktreesChoice', { count: worktrees.length }) }}</p>
        <ul class="mission-delete-dialog__worktrees" :aria-label="t('missions.createdWorktrees')">
          <li v-for="worktree in worktrees" :key="worktree.path" class="mission-delete-dialog__worktree">
            <FolderIcon aria-hidden="true" />
            <span class="mission-delete-dialog__worktree-copy">
              <strong>{{ repositoryName(worktree.repositoryPath) }}</strong>
              <span>{{ worktree.branch }}</span>
              <code>{{ worktree.path }}</code>
            </span>
          </li>
        </ul>
      </template>
      <p v-if="error" class="mission-delete-dialog__error" role="alert">{{ error }}</p>
    </div>

    <template #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button
          v-if="worktrees.length"
          class="app-button app-button--secondary"
          type="button"
          :disabled="busy"
          @click="emit('confirm', false)"
        >
          {{ t('missions.keepWorktrees') }}
        </button>
        <button
          class="app-button mission-delete-dialog__delete"
          type="button"
          :aria-busy="busy"
          :disabled="busy"
          @click="emit('confirm', worktrees.length > 0)"
        >
          {{ worktrees.length ? t('missions.deleteMissionAndWorktrees') : t('missions.deleteAction') }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Mission } from '@workspace/core/missions';
import { missionCreatedWorkspaces } from '@workspace/core/mission-execution';
import { FolderIcon } from '../shared/icons/app-icons';

const props = withDefaults(defineProps<{
  busy?: boolean;
  error?: string | null;
  mission?: Mission | null;
  visible: boolean;
}>(), {
  busy: false,
  error: null,
  mission: null,
});

const emit = defineEmits<{
  close: [];
  confirm: [deleteWorktrees: boolean];
}>();
const { t } = useI18n();

const worktrees = computed(() => missionCreatedWorkspaces(props.mission));

function repositoryName(repositoryPath: string): string {
  return repositoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repositoryPath;
}

function onVisibilityChanged(visible: boolean): void {
  if (!visible && !props.busy) emit('close');
}
</script>

<style scoped>
.mission-delete-dialog__body {
  display: grid;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
}

.mission-delete-dialog__body p {
  margin: 0;
  color: var(--color-text-muted);
}

.mission-delete-dialog__worktrees {
  display: grid;
  gap: var(--space-3);
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.mission-delete-dialog__worktree {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-low);
}

.mission-delete-dialog__worktree > svg {
  flex: 0 0 auto;
  width: var(--icon-lg);
  height: var(--icon-lg);
  margin-top: 2px;
  color: var(--color-primary);
}

.mission-delete-dialog__worktree-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.mission-delete-dialog__worktree-copy span,
.mission-delete-dialog__worktree-copy code {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-delete-dialog__worktree-copy code {
  font-family: var(--font-family-mono);
}

.mission-delete-dialog__error {
  color: var(--color-error) !important;
}

.mission-delete-dialog__delete {
  border-color: var(--color-error);
  color: var(--color-on-error);
  background: var(--color-error);
}

.mission-delete-dialog__delete:hover:not(:disabled) {
  border-color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 86%, black);
}
</style>
