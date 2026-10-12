<template>
  <QuickOpenDialog
    :dialog-label="$t('commands.title')"
    :input-aria-label="$t('commands.search')"
    :placeholder="$t('commands.search')"
    :empty-label="$t('commands.empty')"
    :no-results-label="$t('commands.noResults')"
    :items="items"
    prioritize-label-matches
    @close="emit('close')"
    @select="select"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import QuickOpenDialog from '../shared/QuickOpenDialog.vue';
import type { CommandPaletteAction } from './command-palette-actions';
const props = defineProps<{ actions: CommandPaletteAction[] }>();
const emit = defineEmits<{ close: []; execute: [action: CommandPaletteAction] }>();
const selecting = ref(false);
const items = computed(() => props.actions.map(action => ({
  id: action.id, label: action.label, detail: action.disabledReason, disabled: Boolean(action.disabledReason), keys: action.keys, group: action.group,
  searchText: `${action.label} ${action.aliases ?? ''}`,
})));
function select(id: string): void {
  const action = props.actions.find(item => item.id === id);
  if (selecting.value || !action || action.disabledReason) return;
  selecting.value = true;
  emit('execute', action);
}
</script>
