<template>
  <el-select
    v-if="choices.length > 1 || (showSingleChoice && choices.length > 0) || (preserveSelection && backend && !choices.includes(backend) && choices.length > 0)"
    v-model="backend"
    class="backend-selector"
    :size="size"
    :disabled="disabled"
    :aria-label="t('surface.agentDialog.codingAgent')"
    @update:model-value="rememberBackend"
  >
    <template #prefix>
      <BackendIcon v-if="backend" :backend="backend" />
    </template>
    <el-option
      v-for="choice in choices"
      :key="choice"
      :value="choice"
      :label="backendDisplayName(choice)"
    >
      <span class="backend-selector__option">
        <BackendIcon :backend="choice" />
        {{ backendDisplayName(choice) }}
      </span>
    </el-option>
  </el-select>
  <button v-else-if="choices.length === 0" class="app-button app-button--tertiary" type="button" @click="connectEngine">{{ t('engineConnection.required') }}</button>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentBackend } from '@workspace/core/contracts';
import { useBackendChoices, useConnectEngine, useRememberBackend } from './backend-selection';
import { backendDisplayName } from '@workspace/core/backend-driver';
import BackendIcon from './BackendIcon.vue';

const props = withDefaults(defineProps<{
  remoteConnectionId?: string | null;
  size?: 'small' | 'default' | 'large';
  disabled?: boolean;
  preserveSelection?: boolean;
  showSingleChoice?: boolean;
}>(), { size: 'default', disabled: false });
const backend = defineModel<AgentBackend>();
const choices = useBackendChoices(() => props.remoteConnectionId);
const rememberBackend = useRememberBackend(() => props.remoteConnectionId);
const connectEngine = useConnectEngine();
const { t } = useI18n();
watch(choices, (enabled) => {
  if (props.disabled || (props.preserveSelection && backend.value)) return;
  if (!backend.value || !enabled.includes(backend.value)) backend.value = enabled[0];
}, { immediate: true });
watch(() => props.remoteConnectionId, () => {
  if (!props.disabled && !props.preserveSelection) backend.value = choices.value[0];
});
</script>

<style scoped>
.backend-selector { width: 160px; }
.backend-selector.el-select--small { width: 136px; }
.backend-selector.el-select--large { width: 184px; }
.backend-selector__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>
