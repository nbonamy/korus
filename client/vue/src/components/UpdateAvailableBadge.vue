<script setup lang="ts">
import { translate } from '../i18n';
import { product } from '@workspace/core/product';
import type { DesktopUpdateStatus } from '@workspace/core/contracts';

const props = defineProps<{
  status: DesktopUpdateStatus;
}>();

const emit = defineEmits<{
  install: [];
}>();

function isVisible(): boolean {
  return props.status.state === 'downloaded';
}

function isDownloading(): boolean {
  return props.status.state === 'downloading';
}

function title(): string {
  if (props.status.version) {
    return `Update ${props.status.version} available. Restart ${product.name} to install.`;
  }
  return translate('surface.updateAvailableBadge.updateAvailableRestartAppToInstall');
}
</script>

<template>
  <span
    v-if="isDownloading()"
    class="update-status-badge--busy"
    role="status"
    aria-live="polite"
  >
    <span
      class="app-spinner app-spinner--sm update-status-badge__spinner"
      aria-hidden="true"
    />
    {{ $t('surface.updateAvailableBadge.downloadingUpdate') }}
  </span>
  <button
    v-else-if="isVisible()"
    class="update-available-badge"
    type="button"
    :title="title()"
    :aria-label="title()"
    @click="emit('install')"
  > {{ $t('surface.updateAvailableBadge.updateAvailable') }} </button>
</template>

<style scoped>
.update-status-badge--busy,
.update-available-badge {
  position: static;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 24px;
  padding: 0 var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  font-family: var(--font-family-base);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
  -webkit-app-region: no-drag;
}

.update-status-badge--busy {
  color: var(--color-on-primary);
  background: var(--color-primary);
}

.update-available-badge {
  border-color: var(--color-success);
  color: var(--color-on-success);
  background: var(--color-success);
  cursor: pointer;
}

.update-available-badge:hover,
.update-available-badge:focus-visible {
  color: var(--color-on-success);
  background: color-mix(in srgb, var(--color-success) 86%, #000);
}

.update-available-badge:focus-visible {
  outline: 2px solid var(--color-success);
  outline-offset: 2px;
}

.update-status-badge__spinner {
  margin-right: var(--space-3);
}
</style>
