<template>
  <div class="quick-open-dialog" role="presentation" @mousedown.self="emit('close')">
    <section ref="panel" class="quick-open-dialog__panel" role="dialog" aria-modal="true" :aria-label="dialogLabel" @keydown.escape.stop.prevent="emit('close')" @keydown.tab="trapFocus">
      <div class="quick-open-dialog__search">
        <input
          ref="input"
          v-model="query"
          type="search"
          :aria-label="inputAriaLabel"
          :placeholder="placeholder"
          @keydown.enter.prevent="selectCurrent"
          @keydown.up.prevent="move(-1)"
          @keydown.down.prevent="move(1)"
        />
      </div>
      <div ref="results" class="quick-open-dialog__results" :role="readOnly ? 'list' : undefined" :tabindex="readOnly ? 0 : undefined" :aria-label="readOnly ? dialogLabel : undefined">
        <template v-for="(item, index) in matches" :key="item.id">
          <h3 v-if="item.group && item.group !== matches[index - 1]?.group" class="quick-open-dialog__group">{{ item.group }}</h3>
          <component
            :is="readOnly ? 'div' : 'button'"
            :type="readOnly ? undefined : 'button'"
            :disabled="readOnly ? undefined : item.disabled"
            :role="readOnly ? 'listitem' : undefined"
            class="quick-open-dialog__item"
            :class="{ 'quick-open-dialog__item--selected': index === selectedIndex }"
            @click="select(item.id)"
            @mouseenter="selectedIndex = index"
            @focus="selectedIndex = index"
          >
            <slot name="item" :item="item">
              <span class="quick-open-dialog__row">
                <span class="quick-open-dialog__copy"><span class="quick-open-dialog__label">{{ item.label }}</span><small v-if="item.detail">{{ item.detail }}</small></span>
                <span v-if="item.keys?.length" class="quick-open-dialog__keys"><kbd v-for="(key, keyIndex) in item.keys" :key="keyIndex">{{ key }}</kbd></span>
              </span>
            </slot>
          </component>
        </template>
        <p v-if="matches.length === 0" role="status">{{ query.trim() ? noResultsLabel ?? emptyLabel : emptyLabel }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

export type QuickOpenItem = {
  id: string;
  label: string;
  detail?: string;
  searchText?: string;
  disabled?: boolean;
  keys?: string[];
  group?: string;
};

const props = defineProps<{
  dialogLabel: string;
  emptyLabel: string;
  inputAriaLabel: string;
  items: QuickOpenItem[];
  placeholder: string;
  noResultsLabel?: string;
  readOnly?: boolean;
  prioritizeLabelMatches?: boolean;
}>();
const emit = defineEmits<{ close: []; select: [id: string] }>();
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
const results = ref<HTMLElement | null>(null);
const query = ref('');
const selectedIndex = ref(0);
const matches = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const filtered = props.items.filter((item) => {
    const keys = item.keys ?? [];
    const aliases = keys.map(key => key === '⌘' ? 'cmd' : key);
    const haystack = `${item.searchText ?? `${item.label} ${item.detail ?? ''}`} ${item.group ?? ''} ${keys.join(' ')} ${keys.join('+')} ${aliases.join('+')} ${keys.includes('⌘') ? 'command cmd' : ''}`;
    return terms.every((term) => haystack.toLocaleLowerCase().includes(term));
  });
  if (terms.length && props.prioritizeLabelMatches) {
    const labelMatch = (item: QuickOpenItem) => Number(terms.every(term => item.label.toLocaleLowerCase().includes(term)));
    filtered.sort((left, right) => labelMatch(right) - labelMatch(left));
  }
  return filtered.slice(0, 100);
});
watch(query, () => { selectedIndex.value = 0; });
watch(matches, () => { selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, matches.value.length - 1)); });
onMounted(() => void nextTick(() => input.value?.focus()));
onUnmounted(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function trapFocus(event: KeyboardEvent): void {
  const controls = panel.value?.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex="0"]');
  if (!controls?.length) return;
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
function move(delta: number): void {
  if (!matches.value.length) return;
  selectedIndex.value = (selectedIndex.value + delta + matches.value.length) % matches.value.length;
  void nextTick(() => {
    const selected = results.value?.querySelector<HTMLElement>('.quick-open-dialog__item--selected');
    selected?.scrollIntoView?.({ block: 'nearest' });
  });
}
function selectCurrent(): void { const item = matches.value[selectedIndex.value]; if (item) select(item.id); }
function select(id: string): void {
  if (props.readOnly) return;
  if (!matches.value.some(item => item.id === id && !item.disabled)) return;
  emit('select', id); emit('close');
}
</script>

<style scoped>
.quick-open-dialog {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: color-mix(in srgb, var(--color-surface-highest), transparent 30%);
}

.quick-open-dialog__panel {
  width: min(560px, calc(100vw - var(--space-16)));
  max-height: min(440px, 70vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
}

.quick-open-dialog__search {
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.quick-open-dialog__search input {
  width: 100%;
  border: 0;
  outline: 0;
  color: var(--color-text);
  background: transparent;
  font-size: var(--font-size-16);
}

.quick-open-dialog__results {
  min-height: 0;
  overflow: auto;
  padding: var(--space-2);
}

.quick-open-dialog__item {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
}

.quick-open-dialog__item:hover,
.quick-open-dialog__item--selected {
  background: var(--color-primary-container) !important;
}

.quick-open-dialog__item:disabled {
  color: var(--color-text-muted);
  cursor: default;
}

.quick-open-dialog__results p {
  padding: var(--space-12);
  color: var(--color-text-muted);
  text-align: center;
}

.quick-open-dialog__group {
  margin: var(--space-3) var(--space-4) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
}

.quick-open-dialog__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}

.quick-open-dialog__copy small {
  display: block;
  color: var(--color-text-muted);
  margin-top: var(--space-1);
}

.quick-open-dialog__keys {
  display: flex;
  gap: var(--space-1);
}

.quick-open-dialog__keys kbd {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: var(--font-size-12);
}
</style>
