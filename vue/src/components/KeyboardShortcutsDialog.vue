<template>
  <FormDialog :model-value="true" :title="$t('shortcuts.title')" width="min(620px, calc(100vw - 32px))" teleported @update:model-value="emit('close')" @open-auto-focus="focusSearch" @close-auto-focus="restoreFocus">
    <div class="shortcuts" @keydown.esc.stop.prevent="emit('close')">
      <input ref="search" v-model="query" type="search" :aria-label="$t('shortcuts.search')" :placeholder="$t('shortcuts.search')" class="shortcuts__search" />
      <div class="shortcuts__results" role="region" :aria-label="$t('shortcuts.title')" tabindex="0">
        <section v-for="group in groups" :key="group.id">
          <h3>{{ $t(`shortcuts.groups.${group.id}`) }}</h3>
          <dl>
            <div v-for="item in group.items" :key="item.id" class="shortcuts__row">
              <dt>{{ label(item) }}</dt>
              <dd><kbd v-for="(key, index) in shortcutKeys(item, context)" :key="index">{{ key }}</kbd></dd>
            </div>
          </dl>
        </section>
        <p v-if="!groups.length" role="status">{{ $t(query.trim() ? 'shortcuts.noResults' : 'shortcuts.empty') }}</p>
      </div>
    </div>
    <template #footer><button class="app-button app-button--tertiary" type="button" @click="emit('close')">{{ $t('shortcuts.close') }}</button></template>
  </FormDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, onMounted, ref } from 'vue';
import { availableShortcuts, shortcutKeys, type KeyboardShortcut, type ShortcutContext } from '@workspace/core/keyboard-shortcuts';
import { translate } from '../i18n';
import FormDialog from '../shared/dialog/FormDialog.vue';
const props = defineProps<{ context: ShortcutContext }>();
const emit = defineEmits<{ close: [] }>();
const search = ref<HTMLInputElement | null>(null);
const query = ref('');
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
function label(item: KeyboardShortcut): string {
  return /^agent\d$/.test(item.id) ? translate('shortcuts.actions.agent', { number: item.id.slice(5) }) : translate(`shortcuts.actions.${item.id}`);
}
const groups = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const items = availableShortcuts(props.context).filter(item => {
    const keys = shortcutKeys(item, props.context);
    const aliases = keys.map(key => key === '⌘' ? 'Cmd' : key);
    const text = `${label(item)} ${keys.join(' ')} ${keys.join('+')} ${aliases.join('+')} ${keys.includes('⌘') ? 'command cmd' : ''}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
  return ['navigation', 'agents', 'application'].map(id => ({ id, items: items.filter(item => item.group === id) })).filter(group => group.items.length);
});
onMounted(() => void nextTick(() => search.value?.focus()));
function focusSearch(): void { void nextTick(() => nextTick(() => search.value?.focus())); }
function restoreFocus(event?: Event): void { event?.preventDefault(); if (previousFocus?.isConnected) previousFocus.focus(); }
onUnmounted(() => void nextTick(() => restoreFocus()));
</script>

<style scoped>
.shortcuts { display: flex; flex-direction: column; gap: var(--space-4); }
.shortcuts__search { width: 100%; padding: var(--space-3); color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); font: inherit; }
.shortcuts__search:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.shortcuts__results { max-height: min(420px, 50vh); overflow-y: auto; color: var(--color-text); }
.shortcuts__results h3 { margin: var(--space-4) 0 var(--space-2); color: var(--color-text-muted); font-size: var(--font-size-13); font-weight: var(--font-weight-medium); }
.shortcuts__results dl { margin: 0; }
.shortcuts__row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); padding: var(--space-2) 0; }
.shortcuts__row dd { display: flex; gap: var(--space-1); margin: 0; }
.shortcuts__row kbd { padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font: inherit; white-space: nowrap; }
</style>
