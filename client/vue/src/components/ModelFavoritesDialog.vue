<template>
  <FormDialog
    :model-value="visible"
    :title="$t('surface.appShell.modelFavorites')"
    :subtitle="$t('surface.appShell.dragFavoritesToReorder')"
    width="440px"
    @update:model-value="!$event && emit('close')"
  >
    <div v-if="draftFavorites.length" class="model-favorites-dialog__list">
      <div
        v-for="favorite in draftFavorites"
        :key="modelFavoriteKey(favorite)"
        class="model-favorites-dialog__row"
        :class="favoriteReorder.dropTargetClass(modelFavoriteKey(favorite))"
        v-bind="favoriteReorder.dragItemAttributes(modelFavoriteKey(favorite))"
        @dragstart="favoriteReorder.onDragStart(modelFavoriteKey(favorite), $event)"
        @dragover="favoriteReorder.onDragOver(modelFavoriteKey(favorite), $event)"
        @dragleave="favoriteReorder.onDragLeave(modelFavoriteKey(favorite), $event)"
        @drop="favoriteReorder.onDrop(modelFavoriteKey(favorite), $event)"
        @dragend="favoriteReorder.onDragEnd"
      >
        <button
          class="model-favorites-dialog__reorder"
          type="button"
          :aria-label="$t('surface.appShell.reorderFavorite', { model: modelLabel(favorite) })"
          :title="$t('surface.appShell.dragFavoritesToReorder')"
          @keydown.up.prevent="moveFavorite(favorite, -1)"
          @keydown.down.prevent="moveFavorite(favorite, 1)"
        >
          <ArrowsVerticalIcon aria-hidden="true" />
        </button>
        <div class="model-favorites-dialog__copy">
          <strong>{{ modelLabel(favorite) }}</strong>
          <span>{{ settingsLabel(favorite) }}</span>
        </div>
        <button
          class="model-favorites-dialog__delete"
          type="button"
          :aria-label="$t('surface.appShell.removeFavoriteNamed', { model: modelLabel(favorite) })"
          :title="$t('surface.appShell.removeFavoriteNamed', { model: modelLabel(favorite) })"
          @click="removeFavorite(favorite)"
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-else class="model-favorites-dialog__empty">{{ $t('surface.appShell.noModelFavorites') }}</p>

    <template #footer>
      <button class="app-button app-button--tertiary" type="button" @click="emit('close')">
        {{ $t('common.close') }}
      </button>
    </template>
  </FormDialog>
</template>

<script setup lang="ts">
import type { BackendModelOption, ModelFavorite } from '@workspace/core/contracts';
import { ref, watch } from 'vue';
import { translate } from '../i18n';
import { ArrowsVerticalIcon, Trash2Icon } from '../shared/icons/app-icons';
import { useListReorderDrag } from '../shared/use-list-reorder-drag';
import FormDialog from '../shared/dialog/FormDialog.vue';
import {
  copyModelFavorite,
  modelFavoriteKey,
  modelFavoriteModelLabel,
  modelFavoriteSettingsLabel,
} from './model-favorites';

const props = defineProps<{
  favorites: readonly ModelFavorite[];
  models: readonly BackendModelOption[];
  visible: boolean;
}>();

const emit = defineEmits<{
  change: [favorites: ModelFavorite[]];
  close: [];
}>();

const draftFavorites = ref<ModelFavorite[]>([]);
const favoriteReorder = useListReorderDrag<string>({
  itemIds: () => draftFavorites.value.map(modelFavoriteKey),
  onDrop: ({ draggedId, beforeId }) => reorderFavorite(draggedId, beforeId),
});

watch(() => props.visible, (visible) => {
  if (visible) draftFavorites.value = props.favorites.map(copyModelFavorite);
}, { immediate: true });

function modelLabel(favorite: ModelFavorite): string {
  return modelFavoriteModelLabel(favorite, props.models);
}

function settingsLabel(favorite: ModelFavorite): string {
  return modelFavoriteSettingsLabel(
    favorite,
    props.models,
    translate('surface.appShell.standardSpeed'),
  );
}

function removeFavorite(favorite: ModelFavorite): void {
  commitFavorites(draftFavorites.value.filter((candidate) => modelFavoriteKey(candidate) !== modelFavoriteKey(favorite)));
}

function moveFavorite(favorite: ModelFavorite, offset: -1 | 1): void {
  const sourceIndex = draftFavorites.value.findIndex((candidate) => (
    modelFavoriteKey(candidate) === modelFavoriteKey(favorite)
  ));
  const targetIndex = sourceIndex + offset;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= draftFavorites.value.length) return;
  const next = [...draftFavorites.value];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return;
  next.splice(targetIndex, 0, moved);
  commitFavorites(next);
}

function reorderFavorite(draggedId: string, beforeId: string | null): void {
  const moved = draftFavorites.value.find((favorite) => modelFavoriteKey(favorite) === draggedId);
  if (!moved) return;
  const next = draftFavorites.value.filter((favorite) => modelFavoriteKey(favorite) !== draggedId);
  const targetIndex = beforeId === null
    ? next.length
    : next.findIndex((favorite) => modelFavoriteKey(favorite) === beforeId);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, moved);
  commitFavorites(next);
}

function commitFavorites(favorites: ModelFavorite[]): void {
  const values = favorites.map(copyModelFavorite);
  draftFavorites.value = values;
  emit('change', values);
}
</script>

<style scoped>
.model-favorites-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-favorites-dialog__row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 32px;
  align-items: center;
  gap: 8px;
  min-height: 50px;
  padding: 4px 6px;
  border-radius: var(--radius-md);
  background: var(--color-surface-low);
}

.model-favorites-dialog__row.list-reorder-drag--dragging {
  opacity: 0.45;
}

.model-favorites-dialog__row.list-reorder-drag--drop-before::before,
.model-favorites-dialog__row.list-reorder-drag--drop-after::after {
  position: absolute;
  right: 6px;
  left: 6px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-primary);
  content: '';
}

.model-favorites-dialog__row.list-reorder-drag--drop-before::before { top: -3px; }
.model-favorites-dialog__row.list-reorder-drag--drop-after::after { bottom: -3px; }

.model-favorites-dialog__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.model-favorites-dialog__copy strong,
.model-favorites-dialog__copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-favorites-dialog__copy strong {
  font-size: var(--font-size-14);
  font-weight: 600;
}

.model-favorites-dialog__copy span,
.model-favorites-dialog__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.model-favorites-dialog__reorder,
.model-favorites-dialog__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: transparent;
}

.model-favorites-dialog__reorder { cursor: grab; }
.model-favorites-dialog__delete { cursor: pointer; }

.model-favorites-dialog__reorder:hover,
.model-favorites-dialog__reorder:focus-visible,
.model-favorites-dialog__delete:hover,
.model-favorites-dialog__delete:focus-visible {
  color: var(--color-text);
  background: var(--color-surface-high);
  outline: none;
}

.model-favorites-dialog__reorder > svg,
.model-favorites-dialog__delete > svg {
  width: 17px;
  height: 17px;
}

.model-favorites-dialog__delete:hover,
.model-favorites-dialog__delete:focus-visible { color: var(--color-error); }

.model-favorites-dialog__empty {
  margin: 8px 0;
  text-align: center;
}
</style>
