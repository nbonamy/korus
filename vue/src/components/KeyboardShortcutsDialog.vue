<template>
  <QuickOpenDialog
    :dialog-label="$t('shortcuts.title')"
    :input-aria-label="$t('shortcuts.search')"
    :placeholder="$t('shortcuts.search')"
    :empty-label="$t('shortcuts.empty')"
    :no-results-label="$t('shortcuts.noResults')"
    :items="items"
    read-only
    @close="emit('close')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { availableShortcuts, shortcutKeys, type KeyboardShortcut, type ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import { translate } from '../i18n';
import QuickOpenDialog from '../shared/QuickOpenDialog.vue';
const props = defineProps<{ context: ShortcutContext }>();
const emit = defineEmits<{ close: [] }>();
function label(item: KeyboardShortcut): string {
  return /^agent\d$/.test(item.id) ? translate('shortcuts.actions.agent', { number: item.id.slice(5) }) : translate(`shortcuts.actions.${item.id}`);
}
const items = computed(() => {
  const shortcuts = availableShortcuts(props.context);
  return ['navigation', 'agents', 'application'].flatMap(group => shortcuts.filter(item => item.group === group).map(item => ({
    id: item.id, label: label(item), keys: shortcutKeys(item, props.context), group: translate(`shortcuts.groups.${group}`),
  })));
});
</script>
