<template>
  <section class="remote-claude-auth" aria-live="polite">
    <span v-if="authentication?.loggedIn">{{ $t('surface.remoteClaudeAuth.connected') }}</span>
    <template v-else-if="authentication">
      <span>{{ $t('surface.remoteClaudeAuth.signInRequired') }}</span>
      <button class="app-button app-button--secondary" type="button" @click="dialogVisible = true">
        {{ $t('surface.remoteClaudeAuth.connect') }}
      </button>
    </template>
    <template v-else-if="error">
      <span :title="error">{{ $t('surface.remoteClaudeAuth.unavailable') }}</span>
      <button class="app-button app-button--secondary" type="button" :disabled="checking" @click="refresh">
        {{ $t('surface.remoteClaudeAuth.retry') }}
      </button>
    </template>
    <span v-else>{{ $t('surface.remoteClaudeAuth.checking') }}</span>

    <FormDialog
      v-model="dialogVisible"
      :title="$t('surface.remoteClaudeAuth.dialogTitle')"
      :subtitle="$t('surface.remoteClaudeAuth.runOnHost', { host: connection.host })"
      :teleported="true"
    >
      <div class="app-form-dialog">
        <FormField v-for="option in loginOptions" :key="option.id" :label="$t(option.labelKey)">
          <div class="remote-claude-auth__command-row">
            <code class="remote-claude-auth__command">{{ option.command }}</code>
            <el-button text size="small" :icon="copiedCommand === option.id ? CheckIcon : CopyIcon" :aria-label="$t(copiedCommand === option.id ? option.copiedKey : option.copyKey)" @click="copyCommand(option.id)" />
          </div>
          <p v-if="copyFailedCommand === option.id" class="remote-claude-auth__error">{{ $t('surface.remoteClaudeAuth.copyFailed') }}</p>
        </FormField>
        <p v-if="error" class="remote-claude-auth__error">{{ $t('surface.remoteClaudeAuth.unavailable') }}</p>
      </div>
      <template #footer>
        <button class="app-button app-button--tertiary" type="button" @click="dialogVisible = false">{{ $t('surface.remoteClaudeAuth.close') }}</button>
        <button class="app-button app-button--primary" type="button" :disabled="checking" :aria-busy="checking" @click="refresh">
          {{ $t('surface.remoteClaudeAuth.refresh') }}
        </button>
      </template>
    </FormDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ClaudeAuthentication, AppApi, RemoteConnection } from '@workspace/core/contracts';
import { CheckIcon, CopyIcon } from '../shared/icons/app-icons';
import { appApi } from '../platform-api';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

type ClaudeAuthApi = Pick<AppApi, 'getClaudeAuthentication'>;
const props = defineProps<{ connection: RemoteConnection; api?: ClaudeAuthApi }>();
const emit = defineEmits<{ connected: [] }>();
const baseLoginOptions = [
  { id: 'claudeai', labelKey: 'surface.remoteClaudeAuth.subscriptionLabel', copyKey: 'surface.remoteClaudeAuth.copySubscription', copiedKey: 'surface.remoteClaudeAuth.copiedSubscription', command: 'claude auth login --claudeai' },
  { id: 'console', labelKey: 'surface.remoteClaudeAuth.consoleLabel', copyKey: 'surface.remoteClaudeAuth.copyConsole', copiedKey: 'surface.remoteClaudeAuth.copiedConsole', command: 'claude auth login --console' },
] as const;
type LoginOptionId = (typeof baseLoginOptions)[number]['id'];
const authentication = ref<ClaudeAuthentication | null>(null);
const loginOptions = computed(() => baseLoginOptions.map(option => ({
  ...option,
  command: `${authentication.value?.configDirectory ? `CLAUDE_CONFIG_DIR='${authentication.value.configDirectory.replaceAll("'", "'\\''")}' ` : 'env -u CLAUDE_CONFIG_DIR '}${authentication.value?.executablePath ? `'${authentication.value.executablePath.replaceAll("'", "'\\''")}' auth login --${option.id}` : option.command}`,
})));
const checking = ref(false);
const error = ref('');
const dialogVisible = ref(false);
const copiedCommand = ref<LoginOptionId | null>(null);
const copyFailedCommand = ref<LoginOptionId | null>(null);
let revision = 0;

async function refresh(): Promise<void> {
  const client = props.api ?? appApi;
  if (!client || props.connection.status !== 'ready') return;
  const expectedRevision = ++revision;
  checking.value = true;
  error.value = '';
  try {
    const result = await client.getClaudeAuthentication(props.connection.id);
    if (expectedRevision !== revision) return;
    authentication.value = result;
      if (result.loggedIn) { dialogVisible.value = false; emit('connected'); }
  } catch (cause) {
    if (expectedRevision !== revision) return;
    authentication.value = null;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (expectedRevision === revision) checking.value = false;
  }
}

async function copyCommand(optionId: LoginOptionId): Promise<void> {
  const command = loginOptions.value.find((option) => option.id === optionId)?.command;
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    copiedCommand.value = optionId;
    copyFailedCommand.value = null;
  } catch {
    copiedCommand.value = null;
    copyFailedCommand.value = optionId;
  }
}

watch([() => props.connection.id, () => props.connection.status, () => props.connection.installedAt], () => {
  ++revision;
  authentication.value = null;
  checking.value = false;
  error.value = '';
  dialogVisible.value = false;
  copiedCommand.value = null;
  copyFailedCommand.value = null;
  void refresh();
}, { immediate: true });
onScopeDispose(() => { ++revision; });
</script>

<style scoped>
.remote-claude-auth {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  margin-top: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.remote-claude-auth__command-row {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  min-width: 0;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-lg);
  background: var(--color-surface-base);
}

.remote-claude-auth__command {
  min-width: 0;
  color: var(--color-text);
  overflow-wrap: anywhere;
  user-select: all;
}

.remote-claude-auth__command-row :deep(.el-button) {
  flex: none;
  margin-left: auto;
}

.remote-claude-auth__error {
  margin: 0;
  color: var(--color-error);
}
</style>
