<template>
  <FormDialog
    class="remote-target-dialog"
    :model-value="visible"
    :title="t('remoteTarget.title')"
    @update:model-value="!$event && $emit('close')"
  >
    <form class="app-form-dialog" @submit.prevent="$emit('confirm')">
      <div class="remote-target-dialog__options" role="radiogroup" :aria-label="t('remoteTarget.title')">
        <label
          v-for="connection in connections"
          :key="connection.id"
          class="remote-target-dialog__option"
          :class="{ 'remote-target-dialog__option--disabled': !isSelectable(connection.id) }"
        >
          <input
            v-model="selectedId"
            type="radio"
            name="remote-target"
            :value="connection.id"
            :disabled="!isSelectable(connection.id) || busy"
          />
          <span class="remote-target-dialog__copy">
            <span class="remote-target-dialog__name">{{ connection.name }}</span>
            <span class="remote-target-dialog__status" :class="{ 'remote-target-dialog__status--warning': checkouts[connection.id]?.state === 'missing' }">
              {{ statusText(connection.id) }}
            </span>
          </span>
        </label>
      </div>

      <BackendModelSelector
        v-if="showEngine && selectedId"
        v-model:selection="selection"
        :remote-connection-id="selectedId"
        :disabled="busy"
        @loading="$event && (modelsError = null)"
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
import BackendModelSelector from './BackendModelSelector.vue';
import type { RemoteCheckout } from './use-remote-target';

const props = defineProps<{
  visible: boolean;
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
const modelsError = ref<string | null>(null);

const confirmLabel = computed(() => t(props.checkouts[selectedId.value]?.state === 'missing' ? 'remoteTarget.cloneAndOpen' : 'remoteTarget.open'));

function isSelectable(connectionId: string): boolean {
  const state = props.checkouts[connectionId]?.state;
  return state === 'cloned' || state === 'missing';
}

function statusText(connectionId: string): string {
  const checkout = props.checkouts[connectionId];
  if (!checkout || checkout.state === 'checking') return t('remoteTarget.checking');
  if (checkout.state === 'cloned') return t('remoteTarget.cloned', { path: checkout.path });
  if (checkout.state === 'missing') return checkout.cloneTo ? t('remoteTarget.willCloneTo', { path: checkout.cloneTo }) : t('remoteTarget.willClone');
  if (checkout.state === 'noOrigin') return t('remoteTarget.noOrigin');
  return checkout.message;
}
</script>

<style scoped>
.remote-target-dialog__options {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.remote-target-dialog__option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
}

.remote-target-dialog__option:has(input:checked) {
  border-color: var(--color-primary);
}

.remote-target-dialog__option--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.remote-target-dialog__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.remote-target-dialog__status {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  overflow-wrap: anywhere;
}

.remote-target-dialog__status--warning {
  color: var(--color-warning);
}
</style>
