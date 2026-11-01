<template>
  <el-dialog
    class="app-dialog whats-new-dialog"
    :model-value="visible"
    :teleported="false"
    width="680px"
    :show-close="false"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-dialog__header whats-new-dialog__header">
        <div class="whats-new-dialog__heading">
          <el-select
            v-model="selectedVersion"
            class="whats-new-dialog__version-select"
            :aria-label="$t('surface.whatsNewDialog.releaseVersion')"
            size="small"
            :teleported="false"
          >
            <el-option
              v-for="release in releaseNotes.releases"
              :key="release.version"
              :label="$t('dynamic.version', { version: release.version })"
              :value="release.version"
            />
          </el-select>
          <h2 class="app-dialog__title">{{ $t('surface.whatsNewDialog.whatSNewInApp') }}</h2>
          <p class="app-dialog__subtitle">{{ $t('surface.whatsNewDialog.released') }} {{ formattedReleaseDate }}</p>
        </div>
        <button
          class="app-dialog__icon-button"
          type="button"
          :aria-label="$t('surface.whatsNewDialog.closeWhatSNew')"
          @click="emit('close')"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </template>

    <MarkdownPanel
      class="whats-new-dialog__notes"
      :content="selectedRelease.markdown"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import releaseNotes from '../generated/release-notes.json';
import { X } from '../shared/icons/app-icons';
import MarkdownPanel from './MarkdownPanel.vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const selectedVersion = ref(releaseNotes.currentVersion);
const selectedRelease = computed(() => releaseNotes.releases.find(
  (release) => release.version === selectedVersion.value,
) ?? releaseNotes.releases[0]);
const formattedReleaseDate = computed(() => new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${selectedRelease.value.releasedAt}T00:00:00Z`)));

watch(() => props.visible, (visible) => {
  if (visible) selectedVersion.value = releaseNotes.currentVersion;
});

function onVisibilityChanged(visible: boolean): void {
  if (!visible) emit('close');
}
</script>

<style scoped>
.whats-new-dialog__header {
  align-items: flex-start;
}

.whats-new-dialog__heading {
  display: grid;
  gap: var(--space-1);
}

.whats-new-dialog__version-select {
  width: 132px;
  margin-bottom: var(--space-2);
}

.whats-new-dialog__version-select :deep(.el-select__wrapper) {
  min-height: 26px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-full);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-18);
  box-shadow: none;
}

.whats-new-dialog__version-select :deep(.el-select__selected-item),
.whats-new-dialog__version-select :deep(.el-select__caret) {
  color: inherit;
}

.whats-new-dialog__notes {
  max-height: min(64vh, 620px);
}

.whats-new-dialog__notes :deep(.codex-markdown) {
  max-width: 72ch;
  margin: 0 auto;
}
</style>
