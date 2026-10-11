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
    <button type="button" :aria-label="$t('surface.browserPanel.bookmarks')" :title="$t('surface.browserPanel.bookmarks')" @click="showPicker">
      <IconBookmarks />
    </button>

    <FormDialog v-model="pickerOpen" teleported :title="$t('surface.browserPanel.bookmarks')" @opened="searchInput?.focus()">
      <el-input ref="searchInput" v-model="query" type="search" :aria-label="$t('surface.browserPanel.searchBookmarks')" :placeholder="$t('surface.browserPanel.searchBookmarks')" @keydown.enter.prevent="openFirst" />
      <div class="browser-bookmarks__results">
        <div v-for="bookmark in matches" :key="bookmark.url" class="browser-bookmarks__row">
          <button type="button" class="browser-bookmarks__open" @click="open(bookmark.url)">
            <strong>{{ bookmark.title }}</strong><small>{{ bookmark.url }}</small>
          </button>
          <button type="button" class="browser-bookmarks__edit" :aria-label="$t('surface.browserPanel.editNamedBookmark', { title: bookmark.title })" :title="$t('surface.browserPanel.editBookmark')" @click="edit(bookmark)"><IconPencil /></button>
        </div>
        <p v-if="!matches.length">{{ bookmarks.length ? $t('surface.browserPanel.noMatchingBookmarks') : $t('surface.browserPanel.noBookmarks') }}</p>
      </div>
      <template #footer>
        <button type="button" class="app-button app-button--tertiary" @click="pickerOpen = false">{{ $t('surface.browserPanel.closeBookmarks') }}</button>
      </template>
    </FormDialog>

    <FormDialog :model-value="Boolean(editing)" teleported :close-on-press-escape="!saving" :close-on-click-modal="!saving" :title="editingExisting ? $t('surface.browserPanel.editBookmark') : $t('surface.browserPanel.bookmarkPage')" @update:model-value="closeEditor" @opened="nameInput?.focus()">
      <form :id="formId" @submit.prevent="saveName">
        <FormField :label="$t('surface.browserPanel.bookmarkName')">
          <el-input ref="nameInput" v-model="name" :aria-label="$t('surface.browserPanel.bookmarkName')" :disabled="saving" />
        </FormField>
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
import type { InputInstance } from 'element-plus';
import { IconBookmarks, IconPencil, IconStar } from '@tabler/icons-vue';
import { bookmarkUrl, type BrowserBookmark } from '@workspace/core/browser-bookmarks';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';

const props = withDefaults(defineProps<{
  active?: boolean;
  bookmarks: BrowserBookmark[];
  url: string;
  title: string;
  save: (bookmarks: BrowserBookmark[]) => Promise<void>;
}>(), { active: true });
const emit = defineEmits<{ open: [url: string] }>();
const formId = `bookmark-${useId()}`;
const searchInput = ref<InputInstance>();
const nameInput = ref<InputInstance>();
const currentUrl = computed(() => bookmarkUrl(props.url));
const currentBookmark = computed(() => props.bookmarks.find(bookmark => bookmark.url === currentUrl.value));
const pickerOpen = ref(false);
const query = ref('');
const editing = ref<BrowserBookmark | null>(null);
const name = ref('');
const saving = ref(false);
const saveError = ref(false);
const returnToPicker = ref(false);
const editingExisting = computed(() => props.bookmarks.some(bookmark => bookmark.url === editing.value?.url));
const matches = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  return props.bookmarks.filter(bookmark => terms.every(term => `${bookmark.title} ${bookmark.url}`.toLocaleLowerCase().includes(term)));
});
watch(() => props.active, active => {
  if (!active) { pickerOpen.value = false; editing.value = null; }
});

function showPicker(): void { query.value = ''; pickerOpen.value = true; }
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
function openFirst(): void { if (matches.value[0]) open(matches.value[0].url); }
async function persist(bookmarks: BrowserBookmark[]): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  saveError.value = false;
  try {
    await props.save(bookmarks);
    finishEditing();
  } catch {
    saveError.value = true;
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
  await persist(bookmarks);
}
async function remove(): Promise<void> {
  if (editing.value) await persist(props.bookmarks.filter(bookmark => bookmark.url !== editing.value?.url));
}
</script>

<style scoped>
.browser-bookmarks {
  display: flex;
  align-items: center;
  flex: none;
}

.browser-bookmarks > button,
.browser-bookmarks__edit {
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
.browser-bookmarks__edit svg {
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
.browser-bookmarks__row:focus-within,
.browser-bookmarks__row:hover {
  background: var(--color-surface-high);
}

.browser-bookmarks button:focus-visible,
.browser-bookmarks__open:focus-visible,
.browser-bookmarks__edit:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.browser-bookmarks button:disabled {
  opacity: 0.38;
}

.browser-bookmarks__results {
  max-height: min(340px, 50vh);
  overflow: auto;
  margin-top: var(--space-3);
}

.browser-bookmarks__results p {
  padding: var(--space-6);
  color: var(--color-text-muted);
  text-align: center;
}

.browser-bookmarks__row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
}

.browser-bookmarks__open {
  flex: 1;
  min-width: 0;
  padding: var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: transparent;
  text-align: left;
}

.browser-bookmarks__open strong,
.browser-bookmarks__open small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-bookmarks__open strong {
  font-weight: var(--font-weight-medium);
}

.browser-bookmarks__open small,
.browser-bookmarks__url {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.browser-bookmarks__url {
  overflow-wrap: anywhere;
}

.browser-bookmarks__edit {
  margin-right: var(--space-2);
}

.browser-bookmarks__error {
  color: var(--color-error);
}
</style>
