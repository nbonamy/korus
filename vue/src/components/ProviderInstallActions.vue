<template>
  <span class="provider-install-actions">
    <button v-if="backend === 'antigravity'" type="button" :aria-label="$t('antigravity.install')" :disabled="busy || disabled" :aria-busy="busy || undefined" @click="emit('install')">
      <ElIcon v-if="busy" :size="12" class="is-loading" aria-hidden="true"><RefreshIcon /></ElIcon>
      {{ $t('auth.installProvider') }}
    </button>
    <a v-else :href="url" target="_blank" rel="noopener noreferrer" @click.prevent="appPlatformActions.openExternal?.(url)">{{ $t('auth.installProvider') }}</a>
    <button v-if="backend !== 'antigravity' || !busy" type="button" :aria-label="$t('auth.checkAgain')" :title="$t('auth.checkAgain')" :disabled="busy || disabled" :aria-busy="busy || undefined" @click="emit('refresh')">
      <ElIcon :size="12" :class="{ 'is-loading': busy && backend !== 'antigravity' }" aria-hidden="true"><RefreshIcon /></ElIcon>
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import type { AgentBackend } from '@workspace/core/contracts';
import { appPlatformActions } from '../platform-api';
import { RefreshIcon } from '../shared/icons/app-icons';

const props = defineProps<{ backend: AgentBackend; busy?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ refresh: []; install: [] }>();
const url = computed(() => props.backend === 'codex'
  ? 'https://learn.chatgpt.com/docs/codex/cli#getting-started'
  : 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code');
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
