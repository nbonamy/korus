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
      <div ref="results" class="quick-open-dialog__results">
        <button
          v-for="(item, index) in matches"
          :key="item.id"
          type="button"
          :disabled="item.disabled"
          class="quick-open-dialog__item"
          :class="{ 'quick-open-dialog__item--selected': index === selectedIndex }"
          @click="select(item.id)"
          @mouseenter="selectedIndex = index"
          @focus="selectedIndex = index"
        >
          <slot name="item" :item="item">
            <span>{{ item.label }}</span>
            <small v-if="item.detail">{{ item.detail }}</small>
          </slot>
        </button>
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
};

const props = defineProps<{
  dialogLabel: string;
  emptyLabel: string;
  inputAriaLabel: string;
  items: QuickOpenItem[];
  placeholder: string;
  noResultsLabel?: string;
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
  return props.items.filter((item) => {
    const haystack = item.searchText ?? `${item.label} ${item.detail ?? ''}`;
    return terms.every((term) => haystack.toLocaleLowerCase().includes(term));
  }).slice(0, 100);
});
watch(query, () => { selectedIndex.value = 0; });
watch(matches, () => { selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, matches.value.length - 1)); });
onMounted(() => void nextTick(() => input.value?.focus()));
onUnmounted(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function trapFocus(event: KeyboardEvent): void {
  const controls = panel.value?.querySelectorAll<HTMLElement>('input, button:not(:disabled)');
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
</style>
