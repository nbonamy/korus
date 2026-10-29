<template>
  <FormDialog
    class="remote-target-dialog"
    :class="{ 'remote-target-dialog--progress': progress }"
    :model-value="visible"
    :title="title"
    @update:model-value="!$event && $emit('close')"
  >
    <GitOperationFeedback
      v-if="progress"
      status="running"
      :title="progress.title"
      :detail="progress.detail"
    >
      <template #icon><NetworkIcon /></template>
    </GitOperationFeedback>
    <form v-else class="app-form-dialog" @submit.prevent="$emit('confirm')">
      <div class="remote-target-dialog__machine">
        <el-select v-model="selectedId" :aria-label="t('remoteTarget.machine')" :disabled="busy">
          <el-option
            v-for="connection in connections"
            :key="connection.id"
            :value="connection.id"
            :label="connection.name"
            :disabled="!isSelectable(connection.id)"
          />
        </el-select>
        <p class="remote-target-dialog__status" :class="{ 'remote-target-dialog__status--warning': checkouts[selectedId]?.state === 'missing' }">
          {{ statusText(selectedId) }}
        </p>
      </div>

      <div v-if="showEngine && modelsLoading" class="remote-target-dialog__loading" role="status" aria-busy="true">
        {{ t('remoteTarget.loadingModels') }}
      </div>
      <BackendModelSelector
        v-if="showEngine && selectedId"
        v-show="!modelsLoading"
        v-model:selection="selection"
        :remote-connection-id="selectedId"
        :disabled="busy"
        @loading="modelsLoading = $event; if ($event) modelsError = null"
        @error="modelsError = $event instanceof Error ? $event.message : String($event)"
      />
      <el-alert
        v-if="showEngine && modelsError"
        :title="t('remoteTarget.modelsUnavailable', { detail: modelsError })"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </form>

    <!-- The footer slot must always exist: FormDialog reads it once, so a late slot never renders. -->
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="$emit('close')">{{ $t('common.cancel') }}</button>
      <button
        class="app-button app-button--primary"
        type="button"
        :aria-busy="busy"
        :disabled="!canConfirm"
        @click="$emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RemoteConnection } from '@workspace/core/contracts';
import type { ExecutionSelection } from '@workspace/core/contracts';
import FormDialog from '../shared/dialog/FormDialog.vue';
import { NetworkIcon } from '../shared/icons/app-icons';
import BackendModelSelector from './BackendModelSelector.vue';
import GitOperationFeedback from './GitOperationFeedback.vue';
import type { RemoteCheckout } from './use-remote-target';

const props = defineProps<{
  visible: boolean;
  repositoryName: string;
  action: 'main' | 'new-worktree';
  connections: RemoteConnection[];
  checkouts: Record<string, RemoteCheckout>;
  canConfirm: boolean;
  busy: boolean;
  error: string | null;
  /** Opening a conversation on the machine also needs the engine and model to run it. */
  showEngine?: boolean;
}>();

defineEmits<{
  close: [];
  confirm: [];
}>();

const selectedId = defineModel<string>('selectedId', { default: '' });
const selection = defineModel<ExecutionSelection | undefined>('selection');
const { t } = useI18n();
const title = computed(() => t(props.action === 'main' ? 'remoteTarget.openTitle' : 'remoteTarget.worktreeTitle', { repository: props.repositoryName }));
const modelsError = ref<string | null>(null);
const modelsLoading = ref(false);

/** Looking up machines and cloning are waits, not choices: they get their own screen. */
const progress = computed(() => {
  if (props.busy && props.checkouts[selectedId.value]?.state === 'missing') {
    return {
      title: t('remoteTarget.cloningTitle', { repository: props.repositoryName }),
      detail: t('remoteTarget.onHost', { host: props.connections.find((connection) => connection.id === selectedId.value)?.name ?? '' }),
    };
  }
  // Only the first lookup takes over the dialog; later machines are checked inline.
  if (props.checkouts[selectedId.value]?.state === 'checking' && Object.values(props.checkouts).every((checkout) => checkout.state === 'checking')) {
    return {
      title: t('remoteTarget.checkingTitle', { repository: props.repositoryName }),
      detail: t('remoteTarget.onHost', { host: props.connections.find((connection) => connection.id === selectedId.value)?.name ?? '' }),
    };
  }
  return null;
});

// A worktree continues in its own dialog, so it moves on rather than opens.
const confirmLabel = computed(() => {
  const clones = props.checkouts[selectedId.value]?.state === 'missing';
  if (props.action === 'new-worktree') return t(clones ? 'remoteTarget.cloneAndContinue' : 'remoteTarget.next');
  return t(clones ? 'remoteTarget.cloneAndOpen' : 'remoteTarget.open');
});

/** A machine nobody has asked yet can be chosen; one known to be unusable cannot. */
function isSelectable(connectionId: string): boolean {
  const state = props.checkouts[connectionId]?.state;
  return state === undefined || state === 'checking' || state === 'cloned' || state === 'missing';
}

function statusText(connectionId: string): string {
  const checkout = props.checkouts[connectionId];
  if (!checkout) return '';
  if (checkout.state === 'checking') return t('remoteTarget.checking');
  if (checkout.state === 'cloned') return t('remoteTarget.cloned', { path: checkout.path });
  if (checkout.state === 'missing') return checkout.cloneTo ? t('remoteTarget.willCloneTo', { path: checkout.cloneTo }) : t('remoteTarget.willClone');
  if (checkout.state === 'noOrigin') return t('remoteTarget.noOrigin');
  return checkout.message;
}
</script>

<style scoped>
:global(.remote-target-dialog--progress .el-dialog__footer) {
  display: none;
}

.remote-target-dialog__loading {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-13-5);
}

.remote-target-dialog__machine {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.remote-target-dialog__status {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  overflow-wrap: anywhere;
}

.remote-target-dialog__status--warning {
  color: var(--color-warning);
}
</style>
