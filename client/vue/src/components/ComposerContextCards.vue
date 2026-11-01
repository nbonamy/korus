<template>
  <div class="composer-context-cards" :aria-label="contextLabel">
    <article
      v-for="item in items"
      :key="item.id"
      class="composer-context-cards__card"
      :title="item.title"
    >
      <span class="composer-context-cards__label">
        <component :is="item.icon" v-if="item.icon" class="composer-context-cards__icon" :stroke-width="1.5" aria-hidden="true" />
        {{ item.label }}
      </span>
      <strong v-if="item.detail" class="composer-context-cards__detail">{{ item.detail }}</strong>
      <button
        type="button"
        class="composer-context-cards__remove"
        :aria-label="item.removeLabel"
        :disabled="disabled"
        @click="emit('remove', item.id)"
      >
        <X aria-hidden="true" />
      </button>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { X } from '../shared/icons/app-icons';

export type ComposerContextCard = {
  id: string;
  label: string;
  icon?: Component;
  title?: string;
  detail?: string;
  removeLabel: string;
};

defineProps<{
  contextLabel: string;
  items: readonly ComposerContextCard[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  remove: [itemId: string];
}>();
</script>

<style scoped>
.composer-context-cards {
  display: flex;
  gap: var(--space-4);
  width: 100%;
  margin-top: var(--space-2);
  overflow-x: auto;
}

.composer-context-cards__card {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.composer-context-cards__label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: var(--font-size-11);
}

.composer-context-cards__icon {
  width: 15px;
  height: 15px;
}

.composer-context-cards__detail {
  min-width: 0;
  margin-inline-start: var(--space-2);
  overflow: hidden;
  color: var(--color-text);
  font-weight: 500;
  font-size: var(--font-size-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-context-cards__remove {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  margin-inline-start: var(--space-3);
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  place-items: center;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.composer-context-cards__remove:hover:not(:disabled) {
  background: var(--color-surface-low);
  color: var(--color-text);
}

.composer-context-cards__remove:disabled {
  cursor: default;
  opacity: 0.5;
}

.composer-context-cards__remove svg {
  width: 15px;
  height: 15px;
}
</style>
