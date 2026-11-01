<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="560px"
    append-to-body
    class="app-dialog remote-folder-picker-dialog"
    @update:model-value="onVisibilityChanged"
  >
    <div class="remote-folder-picker-dialog__content">
      <div class="remote-folder-picker-dialog__path">
        <el-input
          v-model="folderPath"
          size="small"
          type="text"
          :aria-label="$t('surface.remoteFolderPickerDialog.remoteFolderPath')"
          :placeholder="$t('surface.remoteFolderPickerDialog.hOME')"
          @keydown.enter.prevent="loadFolders(folderPath)"
        />
        <el-button
          size="small"
          :loading="loading"
          @click="loadFolders(folderPath)"
        > {{ $t('surface.remoteFolderPickerDialog.openPath') }} </el-button>
      </div>

      <p
        v-if="errorMessage"
        class="remote-folder-picker-dialog__error"
      >
        {{ errorMessage }}
      </p>

      <div
        v-if="loading && folderEntries.length === 0"
        class="remote-folder-picker-dialog__empty"
      > {{ $t('surface.remoteFolderPickerDialog.loadingFolders') }} </div>
      <div
        v-else
        class="remote-folder-picker-dialog__list"
      >
        <button
          v-if="folderListing?.parentPath"
          type="button"
          class="remote-folder-picker-dialog__row"
          @click="loadFolders(folderListing.parentPath)"
        >
          <FolderIcon aria-hidden="true" />
          <span>..</span>
        </button>
        <button
          v-for="entry in folderEntries"
          :key="entry.path"
          type="button"
          class="remote-folder-picker-dialog__row"
          @click="loadFolders(entry.path)"
        >
          <FolderIcon aria-hidden="true" />
          <span>{{ entry.name }}</span>
        </button>
        <div
          v-if="!loading && folderEntries.length === 0 && !folderListing?.parentPath"
          class="remote-folder-picker-dialog__empty"
        > {{ $t('surface.remoteFolderPickerDialog.noFolders') }} </div>
      </div>
    </div>

    <template #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" @click="close">{{ $t('surface.remoteFolderPickerDialog.cancel') }}</button>
        <button
          class="app-button app-button--primary"
          type="button"
          :disabled="!folderPath.trim()"
          @click="selectFolder"
        > {{ $t('surface.remoteFolderPickerDialog.selectThisFolder') }} </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, ref, watch } from 'vue';
import type { SourceFolderListing, SourceFolderListInput } from '@workspace/core/contracts';
import { FolderIcon } from '../shared/icons/app-icons';

const props = withDefaults(defineProps<{
  initialPath?: string;
  listSourceFolders: (input?: SourceFolderListInput) => Promise<SourceFolderListing>;
  remoteConnectionId: string;
  title?: string;
  visible: boolean;
}>(), {
  initialPath: '',
  title: translate('surface.remoteFolderPickerDialog.chooseRemoteFolder'),
});

const emit = defineEmits<{
  close: [];
  select: [path: string];
}>();

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const folderPath = ref('');
const folderListing = ref<SourceFolderListing | null>(null);

const folderEntries = computed(() => folderListing.value?.entries ?? []);

watch(() => props.visible, async (visible) => {
  if (!visible) {
    reset();
    return;
  }

  errorMessage.value = null;
  folderPath.value = props.initialPath.trim();
  await loadFolders(folderPath.value || undefined);
});

async function loadFolders(path?: string | null): Promise<void> {
  if (!props.remoteConnectionId) {
    return;
  }

  loading.value = true;
  errorMessage.value = null;
  try {
    const listing = await props.listSourceFolders({
      remoteConnectionId: props.remoteConnectionId,
      ...(path?.trim() ? { path: path.trim() } : {}),
    });
    folderListing.value = listing;
    folderPath.value = listing.path;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function selectFolder(): void {
  const selectedFolder = folderPath.value.trim();
  if (!selectedFolder) {
    return;
  }

  emit('select', selectedFolder);
  close();
}

function onVisibilityChanged(nextVisible: boolean): void {
  if (!nextVisible) {
    close();
  }
}

function close(): void {
  emit('close');
}

function reset(): void {
  loading.value = false;
  errorMessage.value = null;
  folderPath.value = '';
  folderListing.value = null;
}
</script>

<style scoped>
.remote-folder-picker-dialog__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.remote-folder-picker-dialog__path {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-8);
  align-items: center;
}

.remote-folder-picker-dialog__error {
  margin: 0;
  color: var(--color-error);
  font-size: var(--font-size-13);
}

.remote-folder-picker-dialog__list {
  display: flex;
  flex-direction: column;
  max-height: 300px;
  overflow: auto;
}

.remote-folder-picker-dialog__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-8);
  width: 100%;
  min-height: 28px;
  padding: var(--space-4) var(--space-6);
  border: 0;
  border-radius: var(--space-4);
  color: var(--color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.remote-folder-picker-dialog__row:hover,
.remote-folder-picker-dialog__row:focus-visible {
  background: var(--color-surface-low);
}

.remote-folder-picker-dialog__row svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.remote-folder-picker-dialog__row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-folder-picker-dialog__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  padding: var(--space-10);
}
</style>
