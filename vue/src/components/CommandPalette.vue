<template>
  <QuickOpenDialog
    :dialog-label="$t('commands.title')"
    :input-aria-label="$t('commands.search')"
    :placeholder="$t('commands.search')"
    :empty-label="$t('commands.empty')"
    :no-results-label="$t('commands.noResults')"
    :items="items"
    @close="emit('close')"
    @select="select"
  >
    <template #item="{ item }">
      <span class="command-palette__row">
        <span>{{ item.label }}<small v-if="item.detail">{{ item.detail }}</small></span>
        <span class="command-palette__keys"><kbd v-for="(key, index) in keysFor(item.id)" :key="index">{{ key }}</kbd></span>
      </span>
    </template>
  </QuickOpenDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import QuickOpenDialog from '../shared/QuickOpenDialog.vue';
import type { CommandPaletteAction } from './command-palette-actions';
const props = defineProps<{ actions: CommandPaletteAction[] }>();
const emit = defineEmits<{ close: []; execute: [action: CommandPaletteAction] }>();
const selecting = ref(false);
const items = computed(() => props.actions.map(action => ({
  id: action.id, label: action.label, detail: action.disabledReason, disabled: Boolean(action.disabledReason),
  searchText: `${action.label} ${action.aliases ?? ''} ${action.keys?.join(' ') ?? ''} ${action.keys?.join('+') ?? ''} ${action.keys?.map(key => key === '⌘' ? 'cmd' : key).join('+') ?? ''} ${action.keys?.includes('⌘') ? 'command' : ''}`,
})));
function keysFor(id: string): string[] { return props.actions.find(action => action.id === id)?.keys ?? []; }
function select(id: string): void {
  const action = props.actions.find(item => item.id === id);
  if (selecting.value || !action || action.disabledReason) return;
  selecting.value = true;
  emit('execute', action);
}
</script>

<style scoped>
.command-palette__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}
.command-palette__row small {
  display: block;
  color: var(--color-text-muted);
  margin-top: var(--space-1);
}
.command-palette__keys {
  display: flex;
  gap: var(--space-1);
}
.command-palette__keys kbd {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-12);
}
</style>
