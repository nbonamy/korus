<template>
  <span class="remote-host-indicator" :class="{ 'remote-host-indicator--offline': offline }" role="img" :aria-label="label">
    <el-tooltip :content="label" placement="top" :show-after="300">
      <span class="remote-host-indicator__content">
        <WorldIcon v-if="offline || !branch" class="remote-host-indicator__globe" aria-hidden="true" />
        <template v-else>
          <slot />
          <WorldIcon class="remote-host-indicator__badge" aria-hidden="true" />
        </template>
      </span>
    </el-tooltip>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RemoteConnection } from '@workspace/core/contracts';
import { WorldIcon } from '../shared/icons/app-icons';

const props = defineProps<{ connectionId: string; connection?: RemoteConnection; branch?: boolean }>();
const { t } = useI18n();
const offline = computed(() => props.connection?.status !== 'ready');
const label = computed(() => {
  const host = props.connection?.name || props.connection?.host || props.connectionId;
  return offline.value ? t('sidebar.remoteUnavailable', { host }) : host;
});
</script>

<style scoped>
.remote-host-indicator {
  position: relative;
  display: grid;
  justify-self: center;
  flex: none;
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.remote-host-indicator__globe {
  width: 100%;
  height: 100%;
  stroke-width: 1.8;
}

.remote-host-indicator__content {
  display: grid;
  width: 100%;
  height: 100%;
}

.remote-host-indicator__badge {
  position: absolute;
  right: -5px;
  bottom: -4px;
  width: 11px;
  height: 11px;
  padding: 1px;
  border-radius: var(--radius-full);
  color: var(--color-text);
  background: var(--color-surface-base);
}

.remote-host-indicator--offline {
  color: var(--color-error);
}
</style>
