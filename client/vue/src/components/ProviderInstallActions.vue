<template>
  <span class="provider-install-actions">
    <code v-if="installation.command">{{ installation.command }}</code>
    <button v-if="installation.managed" type="button" :aria-label="$t('auth.installNamedProvider', { provider: backendDisplayName(backend) })" :disabled="busy || disabled" :aria-busy="busy || undefined" @click="emit('install')">
      <ElIcon v-if="busy" :size="12" class="is-loading" aria-hidden="true"><RefreshIcon /></ElIcon>
      {{ $t('auth.installProvider') }}
    </button>
    <a v-else-if="installation.instructionsUrl" :href="installation.instructionsUrl" target="_blank" rel="noopener noreferrer" @click.prevent="appPlatformActions.openExternal?.(installation.instructionsUrl!)">{{ $t('auth.installProvider') }}</a>
    <button v-if="!installation.managed || !busy" type="button" :aria-label="$t('auth.checkAgain')" :title="$t('auth.checkAgain')" :disabled="busy || disabled" :aria-busy="busy || undefined" @click="emit('refresh')">
      <ElIcon :size="12" :class="{ 'is-loading': busy }" aria-hidden="true"><RefreshIcon /></ElIcon>
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import type { AgentBackend } from '@workspace/core/contracts';
import { backendDisplayName } from '@workspace/core/backend-driver';
import { resolveProviderSetupCapabilities, type ProviderSetupCapabilities } from '@workspace/core/contracts/provider-setup';
import { appPlatformActions } from '../platform-api';
import { RefreshIcon } from '../shared/icons/app-icons';

const props = defineProps<{ backend: AgentBackend; busy?: boolean; disabled?: boolean; automated?: boolean; capabilities?: ProviderSetupCapabilities }>();
const emit = defineEmits<{ refresh: []; install: [] }>();
const installation = computed(() => resolveProviderSetupCapabilities(props.backend, props.capabilities, props.automated).installation);
</script>

<style scoped>
.provider-install-actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-4);
  -webkit-app-region: no-drag;
}

.provider-install-actions a,
.provider-install-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.provider-install-actions a:hover,
.provider-install-actions button:hover:not(:disabled) {
  color: var(--color-text);
}

.provider-install-actions button:disabled {
  cursor: default;
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .provider-install-actions .el-icon.is-loading {
    animation: none;
  }
}
</style>
