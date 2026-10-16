<template>
  <FormDialog :model-value="modelValue" :title="$t('auth.connectClaude')" :subtitle="$t('auth.claudeLoginInstructions')" teleported @update:model-value="emit('update:modelValue', $event)">
    <div class="app-form-dialog">
      <FormField v-for="option in options" :key="option.kind" :label="$t(option.label)">
        <div class="claude-login-command">
          <code>{{ option.command }}</code>
          <el-button text size="small" :icon="copiedCommand === option.command ? CheckIcon : CopyIcon" :aria-label="$t(copiedCommand === option.command ? option.copiedKey : option.copyKey)" @click="copyCommand(option.command)" />
        </div>
        <p v-if="copyFailedCommand === option.command" role="alert">{{ $t('surface.remoteClaudeAuth.copyFailed') }}</p>
      </FormField>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="emit('update:modelValue', false)">{{ $t('surface.remoteClaudeAuth.close') }}</button>
      <button class="app-button app-button--primary" type="button" :disabled="loading" @click="emit('refresh')">{{ $t('surface.remoteClaudeAuth.refresh') }}</button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { CheckIcon, CopyIcon } from '../shared/icons/app-icons';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

const props = defineProps<{ modelValue: boolean; configDirectory?: string | null; executablePath?: string; loading: boolean; error: string | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; refresh: [] }>();
const copiedCommand = ref<string | null>(null);
const copyFailedCommand = ref<string | null>(null);
const options = computed(() => props.configDirectory === undefined ? [] : ['claudeai', 'console'].map(kind => ({
  kind,
  label: kind === 'console' ? 'surface.remoteClaudeAuth.consoleLabel' : 'surface.remoteClaudeAuth.subscriptionLabel',
  copyKey: kind === 'console' ? 'surface.remoteClaudeAuth.copyConsole' : 'surface.remoteClaudeAuth.copySubscription',
  copiedKey: kind === 'console' ? 'surface.remoteClaudeAuth.copiedConsole' : 'surface.remoteClaudeAuth.copiedSubscription',
  command: `${props.configDirectory ? `CLAUDE_CONFIG_DIR='${props.configDirectory.replaceAll("'", "'\\''")}' ` : 'env -u CLAUDE_CONFIG_DIR '}${props.executablePath ? `'${props.executablePath.replaceAll("'", "'\\''")}'` : 'claude'} auth login --${kind}`,
})));

async function copyCommand(command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command);
    copiedCommand.value = command;
    copyFailedCommand.value = null;
  } catch {
    copiedCommand.value = null;
    copyFailedCommand.value = command;
  }
}
</script>

<style scoped>
.claude-login-command {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-8);
  background: var(--color-surface-base);
  border-radius: var(--radius-lg);
  overflow-wrap: anywhere;
  user-select: all;
}

.claude-login-command code { min-width: 0; }

.claude-login-command :deep(.el-button) {
  flex: none;
  margin-left: auto;
}
</style>
