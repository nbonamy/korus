<template>
  <div
    v-if="connectionState.status !== 'connected'"
    class="app-shell__connection-status"
    :class="`app-shell__connection-status--${connectionState.status}`"
    role="status"
    aria-live="polite"
  >
    <span class="app-shell__connection-status-dot" aria-hidden="true" />
    <span>{{ connectionStatusLabel }}</span>
    <span v-if="connectionStatusDetail" class="app-shell__connection-status-detail">
      {{ connectionStatusDetail }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { BackendConnectionState } from '@workspace/core/contracts';
import { computed } from 'vue';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';

const props = defineProps<{
  connectionState: BackendConnectionState;
}>();

const connectionStatusLabel = computed(() => {
  if (props.connectionState.status === 'connecting') return translate('surface.appShell.connectingToDaemon');
  if (props.connectionState.status === 'reconnecting')
    return translate('surface.appShell.reconnectingToDaemonAgentsKeepWorkingInTheBackground');
  return translate('surface.appShell.daemonIsUnavailableReconnectionWillContinueAutomatically');
});
const connectionStatusDetail = computed(() => localizedText(props.connectionState.detail, translate));
</script>

<style scoped>
.app-shell__connection-status {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 5px 14px;
  border-bottom: 1px solid var(--color-outline-subtle);
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-size: 12px;
}

.app-shell__connection-status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--color-warning);
}

.app-shell__connection-status--error .app-shell__connection-status-dot {
  background: var(--color-error);
}

.app-shell__connection-status-detail {
  min-width: 0;
  overflow: hidden;
  opacity: 0.78;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
