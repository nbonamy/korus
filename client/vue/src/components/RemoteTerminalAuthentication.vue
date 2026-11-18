<template>
  <FormDialog
    :model-value="visible"
    :title="$t('surface.remoteTerminalAuth.title', { provider: providerDisplayName(provider) })"
    :subtitle="commands.length ? $t('surface.remoteTerminalAuth.runOnHost', { host: connection.host }) : undefined"
    teleported
    @update:model-value="!$event && emit('cancel')"
  >
    <div class="app-form-dialog">
      <FormField v-for="option in commands" :key="option.label" :label="option.label">
        <div class="remote-terminal-auth__command-row">
          <code class="remote-terminal-auth__command">{{ option.command }}</code>
          <CopyButton :label="option.copyLabel" :copied-label="option.copiedLabel" :action="() => copyCommand(option.command)" />
        </div>
        <p v-if="copyFailedCommand === option.command" class="remote-terminal-auth__error" role="alert">{{ $t('surface.remoteClaudeAuth.copyFailed') }}</p>
      </FormField>
      <p v-if="commands.length && hint" class="app-form-dialog__help">{{ hint }}</p>
      <p v-if="issue || check === 'failed'" class="remote-terminal-auth__error" role="alert">{{ issue || $t('surface.remoteTerminalAuth.unavailable', { host: connection.host }) }}</p>
      <p v-else-if="check === 'pending'" class="app-form-dialog__help" role="status">{{ $t('surface.remoteTerminalAuth.pending') }}</p>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary agent-ui-interactive" type="button" @click="emit('cancel')">{{ $t('surface.remoteClaudeAuth.close') }}</button>
      <button data-variant="primary" data-appearance="solid" class="app-button app-button--primary agent-ui-interactive" type="button" :disabled="checking" :aria-busy="checking" @click="refresh">
        {{ $t('surface.remoteTerminalAuth.check') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';
import type { AppApi, HarnessProvider, RemoteConnection } from '@workspace/core/contracts';
import type { ProviderAuthentication } from '@workspace/core/contracts/provider-setup';
import { providerDisplayName } from '@workspace/core/provider-driver';
import { CopyButton } from '@korus-dev/agent-ui-sdk';
import { appApi } from '../platform-api';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

const props = defineProps<{
  connection: RemoteConnection;
  provider: HarnessProvider;
  commands: readonly { label: string; command: string; copyLabel: string; copiedLabel: string }[];
  hint?: string;
  issue?: string;
  api?: Pick<AppApi, 'authenticateProvider'>;
}>();
const emit = defineEmits<{ checked: [authentication: ProviderAuthentication]; connected: []; cancel: []; activity: [active: boolean] }>();
const visible = ref(false);
const checking = ref(false);
const check = ref<'failed' | 'pending'>();
const copyFailedCommand = ref<string>();
let revision = 0;

watch(checking, active => emit('activity', active), { immediate: true });

async function refresh(): Promise<void> {
  const client = props.api ?? appApi;
  if (!client || !visible.value || checking.value) return;
  const expected = ++revision;
  checking.value = true;
  check.value = undefined;
  try {
    const result = await client.authenticateProvider(props.provider, 'check', { remoteConnectionId: props.connection.id });
    if (expected !== revision) return;
    if (result.kind !== props.provider) throw new Error('Engine authentication response did not match the request.');
    if (result.connected) {
      visible.value = false;
      emit('connected');
    } else {
      check.value = 'pending';
      emit('checked', result);
    }
  } catch {
    if (expected === revision) check.value = 'failed';
  } finally {
    if (expected === revision) checking.value = false;
  }
}

async function copyCommand(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    copyFailedCommand.value = undefined;
  } catch (cause) {
    copyFailedCommand.value = command;
    throw cause;
  }
}

watch([() => props.provider, () => props.connection.id, () => props.connection.status, () => props.connection.installedAt], () => {
  ++revision;
  visible.value = props.connection.status === 'ready';
  checking.value = false;
  check.value = undefined;
  copyFailedCommand.value = undefined;
}, { immediate: true });
onScopeDispose(() => { ++revision; emit('activity', false); });
</script>

<style scoped>
.remote-terminal-auth__command-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  min-width: 0;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-lg);
  background: var(--color-surface-base);
}

.remote-terminal-auth__command {
  min-width: 0;
  color: var(--color-text);
  overflow-wrap: anywhere;
  user-select: all;
}

.remote-terminal-auth__command-row :deep(.el-button) {
  flex: none;
  margin-left: auto;
}

.remote-terminal-auth__error {
  margin: 0;
  color: var(--color-error);
}
</style>
