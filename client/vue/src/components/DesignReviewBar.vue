<template>
  <div class="design-review-bar">
    <div v-if="commenting" class="design-review-bar__comment"><slot name="comment" /></div>
    <div class="design-review-bar__summary">
      <strong>{{ board.title }}</strong>
      <p v-if="board.notes">{{ board.notes }}</p>
    </div>
    <div class="design-review-bar__actions">
      <button class="app-icon-button" type="button" :aria-label="t('design.reviewComment')" :title="t('design.reviewComment')" :disabled="disabled" @click="emit('comment')"><MessageCircleIcon /></button>
      <button class="app-icon-button" type="button" :aria-label="t(chosen ? 'design.chosen' : 'design.chooseDirection')" :title="t(chosen ? 'design.chosen' : 'design.chooseDirection')" :aria-pressed="chosen" :disabled="disabled || chosen" @click="emit('choose')"><CheckIcon /></button>
      <button class="app-button app-button--primary" type="button" data-action="build" :disabled="disabled" @click="emit('build')"><CodeIcon />{{ t('design.buildThis') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DesignArtboard } from '@workspace/core/design';
import { translate as t } from '../i18n';
import { CheckIcon, CodeIcon, MessageCircleIcon } from '../shared/icons/app-icons';
defineProps<{ board: DesignArtboard; chosen: boolean; disabled: boolean; commenting: boolean }>();
const emit = defineEmits<{ comment: []; choose: []; build: [] }>();
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
.design-review-bar__summary p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
.design-review-bar__actions [aria-pressed="true"] {
  color: var(--color-primary);
  opacity: 1;
}
</style>
