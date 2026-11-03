<template>
  <div class="design-review-bar">
    <div v-if="commenting" class="design-review-bar__comment"><slot name="comment" /></div>
    <div class="design-review-bar__summary">
      <strong :title="board.title">{{ board.title }}</strong>
    </div>
    <div class="design-review-bar__actions">
      <button class="app-button app-button--secondary" type="button" :aria-label="t('design.reviewComment')" :title="t('design.reviewComment')" :disabled="disabled" @click="emit('comment')"><MessageCircleIcon />{{ t('design.commentAction') }}</button>
      <button class="app-button app-button--primary" type="button" data-action="build" :disabled="disabled" @click="emit('build')"><CodeIcon />{{ t('design.buildThis') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DesignArtboard } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { CodeIcon, MessageCircleIcon } from '../shared/icons/app-icons';
defineProps<{ board: DesignArtboard; disabled: boolean; commenting: boolean }>();
const emit = defineEmits<{ comment: []; build: [] }>();
</script>

<style scoped>
.design-review-bar {
  position: absolute;
  z-index: 2;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 32px);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}
.design-review-bar__summary {
  min-width: 0;
  max-width: 340px;
  font-size: var(--font-size-13);
}
.design-review-bar__comment {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}
.design-review-bar__summary strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}
.design-review-bar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}
.design-review-bar__actions .app-button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  white-space: nowrap;
}
.design-review-bar__actions svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

@container design-canvas-controls (max-width: 420px) {
  .design-review-bar { flex-wrap: wrap; }
  .design-review-bar__summary { flex-basis: 100%; max-width: 100%; }
  .design-review-bar__actions { margin-left: auto; }
}
</style>
