<template>
  <span class="browser-bookmarks">
    <button
      type="button"
      :aria-label="currentBookmark ? $t('surface.browserPanel.editBookmark') : $t('surface.browserPanel.bookmarkPage')"
      :title="currentUrl ? (currentBookmark ? $t('surface.browserPanel.editBookmark') : $t('surface.browserPanel.bookmarkPage')) : $t('surface.browserPanel.bookmarkSupportedUrls')"
      :aria-pressed="Boolean(currentBookmark)"
      :disabled="!currentUrl || saving"
      @click="editCurrent"
    ><IconStar :class="{ 'browser-bookmarks__star--saved': currentBookmark }" /></button>
    <button ref="pickerTrigger" type="button" :aria-label="$t('surface.browserPanel.bookmarks')" :title="$t('surface.browserPanel.bookmarks')" @click="showPicker">
      <IconBookmarks />
    </button>

    <Teleport to="body">
      <QuickOpenDialog
        v-if="pickerOpen"
        :dialog-label="$t('surface.browserPanel.bookmarks')"
        :input-aria-label="$t('surface.browserPanel.searchBookmarks')"
        :placeholder="$t('surface.browserPanel.searchBookmarks')"
        :empty-label="$t('surface.browserPanel.noBookmarks')"
        :no-results-label="$t('surface.browserPanel.noMatchingBookmarks')"
        :items="pickerItems"
        :return-focus-to="pickerTrigger"
        @select="open"
        @close="pickerOpen = false"
      >
        <template #item="{ item }">
          <span class="browser-bookmarks__copy"><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></span>
        </template>
        <template #item-actions="{ item }">
          <button type="button" class="browser-bookmarks__action" :disabled="saving" :aria-label="$t('surface.browserPanel.editNamedBookmark', { title: item.label })" :title="$t('surface.browserPanel.editBookmark')" @click="edit({ title: item.label, url: item.id })"><IconPencil aria-hidden="true" /></button>
          <button type="button" class="browser-bookmarks__action" :disabled="saving" :aria-label="$t('surface.browserPanel.removeNamedBookmark', { title: item.label })" :title="$t('surface.browserPanel.removeBookmark')" @click="removeBookmark(item.id)"><IconTrash aria-hidden="true" /></button>
        </template>
        <template #feedback>
          <p v-if="saveError" role="alert" class="browser-bookmarks__error browser-bookmarks__picker-error">{{ $t('surface.browserPanel.bookmarkSaveFailed') }}</p>
        </template>
      </QuickOpenDialog>
    </Teleport>

    <FormDialog :model-value="Boolean(editing)" teleported :close-on-press-escape="!saving" :close-on-click-modal="!saving" :title="editingExisting ? $t('surface.browserPanel.editBookmark') : $t('surface.browserPanel.bookmarkPage')" @update:model-value="closeEditor" @opened="nameInput?.focus()">
      <form :id="formId" class="browser-bookmarks__form" @submit.prevent="saveName">
        <input ref="nameInput" v-model="name" :aria-label="$t('surface.browserPanel.bookmarkName')" :placeholder="$t('surface.browserPanel.bookmarkName')" :disabled="saving" autocomplete="off" />
        <p class="browser-bookmarks__url">{{ editing?.url }}</p>
        <p v-if="saveError" role="alert" class="browser-bookmarks__error">{{ $t('surface.browserPanel.bookmarkSaveFailed') }}</p>
      </form>
      <template #footer-left>
        <button v-if="editingExisting" type="button" class="app-button app-button--tertiary" :disabled="saving" @click="remove">{{ $t('surface.browserPanel.removeBookmark') }}</button>
      </template>
      <template #footer>
        <button type="button" class="app-button app-button--tertiary" :disabled="saving" @click="closeEditor">{{ $t('surface.browserPanel.cancelBookmark') }}</button>
        <button type="submit" :form="formId" class="app-button app-button--primary" :disabled="saving || !name.trim()">{{ $t('surface.browserPanel.saveBookmark') }}</button>
      </template>
    </FormDialog>
  </span>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { IconBookmarks, IconPencil, IconStar, IconTrash } from '@tabler/icons-vue';
import { bookmarkUrl, type BrowserBookmark } from '@workspace/core/browser-bookmarks';
import FormDialog from '../shared/dialog/FormDialog.vue';
import QuickOpenDialog from '../shared/QuickOpenDialog.vue';

const props = withDefaults(defineProps<{
  active?: boolean;
  bookmarks: BrowserBookmark[];
  url: string;
  title: string;
  save: (bookmarks: BrowserBookmark[]) => Promise<void>;
}>(), { active: true });
const emit = defineEmits<{ open: [url: string] }>();
const formId = `bookmark-${useId()}`;
const nameInput = ref<HTMLInputElement>();
const pickerTrigger = ref<HTMLButtonElement | null>(null);
const currentUrl = computed(() => bookmarkUrl(props.url));
const currentBookmark = computed(() => props.bookmarks.find(bookmark => bookmark.url === currentUrl.value));
const pickerOpen = ref(false);
const editing = ref<BrowserBookmark | null>(null);
const name = ref('');
const saving = ref(false);
const saveError = ref(false);
const returnToPicker = ref(false);
const editingExisting = computed(() => props.bookmarks.some(bookmark => bookmark.url === editing.value?.url));
const pickerItems = computed(() => props.bookmarks.map(bookmark => ({ id: bookmark.url, label: bookmark.title, detail: bookmark.url, disabled: saving.value })));
watch(() => props.active, active => {
  if (!active) { pickerOpen.value = false; editing.value = null; }
});

function showPicker(): void { saveError.value = false; pickerOpen.value = true; }
function editCurrent(): void {
  if (currentUrl.value) edit(currentBookmark.value ?? { title: props.title.trim() || new URL(currentUrl.value).host, url: currentUrl.value });
}
function edit(bookmark: BrowserBookmark): void {
  returnToPicker.value = pickerOpen.value;
  pickerOpen.value = false;
  editing.value = { ...bookmark };
  name.value = bookmark.title;
  saveError.value = false;
}
function finishEditing(): void {
  editing.value = null;
  if (returnToPicker.value && props.active) pickerOpen.value = true;
}
function closeEditor(): void { if (!saving.value) finishEditing(); }
function open(url: string): void {
  const target = bookmarkUrl(url);
  if (!target) return;
  pickerOpen.value = false;
  emit('open', target);
}
async function persist(bookmarks: BrowserBookmark[]): Promise<boolean> {
  if (saving.value) return false;
  saving.value = true;
  saveError.value = false;
  try {
    await props.save(bookmarks);
    return true;
  } catch {
    saveError.value = true;
    return false;
  } finally {
    saving.value = false;
  }
}
async function saveName(): Promise<void> {
  if (!editing.value || !name.value.trim()) return;
  const updated = { ...editing.value, title: name.value.trim() };
  const bookmarks = props.bookmarks.filter(bookmark => bookmark.url !== updated.url);
  const index = props.bookmarks.findIndex(bookmark => bookmark.url === updated.url);
  bookmarks.splice(index < 0 ? bookmarks.length : index, 0, updated);
  if (await persist(bookmarks)) finishEditing();
}
async function remove(): Promise<void> {
  if (editing.value && await persist(props.bookmarks.filter(bookmark => bookmark.url !== editing.value?.url))) finishEditing();
}
async function removeBookmark(url: string): Promise<void> {
  await persist(props.bookmarks.filter(bookmark => bookmark.url !== url));
}
</script>

<style scoped>
.browser-bookmarks {
  display: flex;
  align-items: center;
  flex: none;
}

.browser-bookmarks > button,
.browser-bookmarks__action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
}

.browser-bookmarks svg,
.browser-bookmarks__action svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
}

.browser-bookmarks__star--saved {
  fill: currentColor;
  color: var(--color-primary);
}

.browser-bookmarks button:hover,
.browser-bookmarks button:focus-visible,
.browser-bookmarks__action:hover {
  background: var(--color-surface-high);
}

.browser-bookmarks button:focus-visible,
.browser-bookmarks__action:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.browser-bookmarks button:disabled {
  opacity: 0.38;
}

.browser-bookmarks__copy strong,
.browser-bookmarks__copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-bookmarks__copy strong {
  font-weight: var(--font-weight-medium);
}

.browser-bookmarks__copy small,
.browser-bookmarks__url {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.browser-bookmarks__url {
  overflow-wrap: anywhere;
}

.browser-bookmarks__form {
  padding: var(--space-4) 0;
}

.browser-bookmarks__form input {
  box-sizing: border-box;
  width: 100%;
  border: 0;
  border-radius: 0;
  padding: var(--space-4) 0;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  outline: none;
}

.browser-bookmarks__error {
  color: var(--color-error);
}

.browser-bookmarks__picker-error {
  margin: 0;
  padding: var(--space-3) var(--space-6);
}
</style>
