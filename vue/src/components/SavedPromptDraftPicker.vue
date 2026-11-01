<template>
  <div ref="pickerRoot" class="saved-prompt-draft-picker" role="region" :aria-label="t('chat.savedDrafts.title')" :tabindex="drafts.length === 0 ? -1 : undefined" @keydown.esc="closeOnEscape">
    <div v-if="drafts.length > 0" class="saved-prompt-draft-picker__header">
      <input
        ref="searchInput"
        v-model="query"
        class="saved-prompt-draft-picker__search"
        type="search"
        role="searchbox"
        :aria-label="t('chat.savedDrafts.search')"
        :aria-controls="listId"
        :aria-activedescendant="activeDraft ? optionId(activeDraft.id) : undefined"
        :placeholder="t('chat.savedDrafts.search')"
        @keydown="handleKeydown"
      />
      <span class="saved-prompt-draft-picker__hint">{{ t('chat.savedDrafts.hint') }}</span>
    </div>
    <div :id="listId" class="saved-prompt-draft-picker__list" role="list">
      <div
        v-for="(draft, index) in matches"
        :key="draft.id"
        :id="optionId(draft.id)"
        class="saved-prompt-draft-picker__row"
        :class="{ 'saved-prompt-draft-picker__row--active': index === activeIndex }"
        role="listitem"
        :aria-current="index === activeIndex ? 'true' : undefined"
        @mouseenter="activeIndex = index"
      >
        <button class="saved-prompt-draft-picker__text" type="button" :title="draft.text" @click="emit('select', { id: draft.id, keep: $event.shiftKey })">
          {{ preview(draft.text) }}
        </button>
        <button class="saved-prompt-draft-picker__action" type="button" :aria-label="t('chat.savedDrafts.delete')" :title="t('chat.savedDrafts.delete')" @click="emit('delete', draft.id)">
          <XIcon aria-hidden="true" />
        </button>
      </div>
      <p v-if="matches.length === 0" class="saved-prompt-draft-picker__empty">
        {{ t(drafts.length === 0 ? 'chat.savedDrafts.empty' : 'chat.savedDrafts.noMatch') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { IconX as XIcon } from '@tabler/icons-vue';
import type { SavedPromptDraft } from '@workspace/core/contracts';

const props = defineProps<{ drafts: readonly SavedPromptDraft[] }>();
const emit = defineEmits<{
  close: [];
  delete: [id: string];
  select: [selection: { id: string; keep: boolean }];
}>();
const { t } = useI18n();
const pickerRoot = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const query = ref('');
const activeIndex = ref(0);
const listId = `saved-prompt-drafts-${crypto.randomUUID()}`;
const matches = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return [...props.drafts].reverse().filter((draft) => terms.every((term) => draft.text.toLocaleLowerCase().includes(term)));
});
const activeDraft = computed(() => matches.value[activeIndex.value]);
watch(query, () => { activeIndex.value = 0; });
watch(matches, (items) => { activeIndex.value = Math.min(activeIndex.value, Math.max(0, items.length - 1)); });
function focusPicker(): void { (searchInput.value ?? pickerRoot.value)?.focus(); }
onMounted(() => void nextTick(focusPicker));
watch(() => props.drafts.length === 0, () => void nextTick(focusPicker));

function optionId(id: string): string { return `${listId}-${id}`; }
function preview(text: string): string { return text.replace(/\s+/gu, ' ').trim(); }
function closeOnEscape(event: KeyboardEvent): void { event.preventDefault(); emit('close'); }
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (matches.value.length) activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + matches.value.length) % matches.value.length;
    return;
  }
  if (event.key === 'Enter' && activeDraft.value) {
    event.preventDefault();
    emit('select', { id: activeDraft.value.id, keep: event.shiftKey });
  }
}
</script>

<style scoped>
.saved-prompt-draft-picker {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
}
.saved-prompt-draft-picker:focus { outline: none; }

.saved-prompt-draft-picker__header { display: flex; align-items: center; border-bottom: 1px solid var(--color-border); }
.saved-prompt-draft-picker__search {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
}

.saved-prompt-draft-picker__list { min-height: 0; overflow-y: auto; padding: var(--space-2); }
.saved-prompt-draft-picker__row { display: flex; align-items: center; min-width: 0; border-radius: var(--radius-lg); }
.saved-prompt-draft-picker__row:hover,
.saved-prompt-draft-picker__row--active { background: var(--color-surface); }
.saved-prompt-draft-picker__text {
  display: -webkit-box;
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--space-2) var(--space-4);
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
}
.saved-prompt-draft-picker__action {
  display: grid;
  width: 32px;
  height: 24px;
  flex: 0 0 32px;
  place-items: center;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.saved-prompt-draft-picker__action:hover { color: var(--color-text); background: var(--color-surface-high); }
.saved-prompt-draft-picker__action svg { width: var(--icon-sm); height: var(--icon-sm); }
.saved-prompt-draft-picker__empty { margin: 0; padding: var(--space-2) var(--space-4); color: var(--color-text-muted); font: inherit; }
.saved-prompt-draft-picker__hint { flex: 0 0 auto; padding-right: var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-12); white-space: nowrap; }
</style>
