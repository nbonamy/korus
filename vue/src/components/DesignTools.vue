<template>
  <div class="design-tools">
    <div class="design-tools__group" data-design-tools>
      <AppMenuButton :items="boardItems" :ariaLabel="t('design.artboard')" :width="240" placement="bottom-start" @select="emit('focus', $event)">
        <template #trigger="{ attrs }">
          <button v-bind="attrs" class="design-tools__menu design-tools__board" type="button" :disabled="locked" :aria-label="t('design.artboard')" :title="boardTitle">
            <RectangleIcon class="design-tools__board-icon" /><span>{{ boardTitle }}</span><ChevronDown />
          </button>
        </template>
      </AppMenuButton>
      <span v-if="!play" class="design-tools__divider" />
      <button v-if="!play" class="app-icon-button" type="button" :aria-label="t('design.selectElements')" :title="t('design.selectElements')" :aria-pressed="!pan" :disabled="interacting" @click="emit('pan', false)"><PointerIcon /></button>
      <button v-if="!play" class="app-icon-button" type="button" :aria-label="t('design.panCanvas')" :title="t('design.panCanvas')" :aria-pressed="pan" :disabled="interacting" @click="emit('pan', true)"><HandMoveIcon /></button>
    </div>
    <div class="design-tools__group" data-design-tools>
      <button class="app-icon-button" type="button" data-action="play" :aria-label="t(play ? 'design.edit' : 'design.play')" :title="t(play ? 'design.edit' : 'design.play')" :aria-pressed="play" :disabled="locked" @click="emit('play')"><PointerIcon v-if="play" /><PlayerPlayIcon v-else /></button>
      <button v-if="!play" class="app-icon-button" type="button" :aria-label="t(inspectorVisible ? 'design.hideInspector' : 'design.showInspector')" :title="t(inspectorVisible ? 'design.hideInspector' : 'design.showInspector')" :aria-pressed="inspectorVisible" :disabled="interacting" @click="emit('inspector')"><LayoutSidebarRightIcon /></button>
      <span class="design-tools__divider" />
      <AppMenuButton :items="zoomItems" :ariaLabel="t('design.zoom')" :width="180" @select="changeZoom">
        <template #trigger="{ attrs }"><button v-bind="attrs" class="design-tools__menu design-tools__zoom" type="button" :disabled="interacting" :aria-label="t('design.zoom')" :title="t('design.zoom')"><span>{{ zoom < 0.1 ? Math.round(zoom * 1000) / 10 : Math.round(zoom * 100) }}%</span><ChevronDown /></button></template>
      </AppMenuButton>
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DesignArtboard } from '@workspace/core/design';
import { translate as t } from '../i18n';
import AppMenuButton from '../shared/menu/AppMenuButton.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { ChevronDown, HandMoveIcon, LayoutSidebarRightIcon, PlayerPlayIcon, PointerIcon, RectangleIcon } from '../shared/icons/app-icons';

const props = defineProps<{ artboards: DesignArtboard[]; selectedArtboardId: string | null; locked: boolean; interacting: boolean; play: boolean; pan: boolean; inspectorVisible: boolean; zoom: number; zoomChoice: number | 'fit' | 'selection' }>();
const emit = defineEmits<{ focus: [artboardId: string]; pan: [value: boolean]; play: []; inspector: []; zoom: [value: number | 'fit' | 'selection'] }>();
const boardTitle = computed(() => props.artboards.find(board => board.id === props.selectedArtboardId)?.title ?? t('design.artboard'));
const boardItems = computed<AppMenuItem[]>(() => props.artboards.map(board => ({ type: 'radio', id: board.id, label: board.title, checked: board.id === props.selectedArtboardId })));
const zoomItems = computed<AppMenuItem[]>(() => [
  { type: 'action', id: 'fit', label: t('design.fitAll') },
  { type: 'action', id: 'selection', label: t('design.fitArtboard') },
  { type: 'separator', id: 'zoom-values' },
  ...[0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(value => ({ type: 'radio' as const, id: String(value), label: `${value * 100}%`, checked: props.zoomChoice === value })),
]);
function changeZoom(value: string) { emit('zoom', value === 'fit' || value === 'selection' ? value : Number(value)); }
</script>

<style scoped>
.design-tools {
  position: absolute;
  z-index: 2;
  inset: var(--space-4) var(--space-4) auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
  pointer-events: none;
}

.design-tools__group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
}

.design-tools__divider {
  width: 1px;
  height: 20px;
  margin-inline: var(--space-1);
  background: var(--color-border);
}

.design-tools__menu {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 28px;
  padding-inline: var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-13);
  cursor: pointer;
}

.design-tools__menu:hover:not(:disabled),
.design-tools__menu[aria-expanded="true"] {
  background: var(--color-surface-low);
}

.design-tools__menu:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.design-tools__menu:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.design-tools__menu svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
}

.design-tools__board {
  max-width: 200px;
}

.design-tools__board span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.design-tools__board .design-tools__board-icon {
  display: none;
}

.design-tools__zoom {
  font-variant-numeric: tabular-nums;
}

.design-tools .app-icon-button[aria-pressed="true"] {
  color: var(--color-primary);
  background: var(--color-primary-container);
}

@container design-canvas-controls (max-width: 520px) {
  .design-tools__board span {
    display: none;
  }

  .design-tools__board .design-tools__board-icon {
    display: block;
  }

  .design-tools__menu {
    gap: var(--space-1);
    padding-inline: var(--space-1);
  }

  .design-tools__divider {
    margin-inline: 0;
  }
}
</style>
