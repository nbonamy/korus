<template>
  <section
    class="image-preview-panel"
    :aria-label="panel.title"
  >
    <div
      ref="viewport"
      class="image-preview-panel__viewport"
      @wheel="handleWheel"
    >
      <div
        ref="stage"
        class="image-preview-panel__stage"
        :style="stageStyle"
      >
        <img
          ref="image"
          :src="panel.src"
          :alt="panel.alt"
          draggable="false"
          @load="fitImage"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SidePanelImageState } from './side-panel';

const props = defineProps<{
  panel: SidePanelImageState;
}>();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

const viewport = ref<HTMLElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const fittedSize = ref({ width: 0, height: 0 });
const zoom = ref(1);
let resizeObserver: ResizeObserver | null = null;

const stageStyle = computed(() => fittedSize.value.width > 0 && fittedSize.value.height > 0
  ? {
    width: `${fittedSize.value.width * zoom.value}px`,
    height: `${fittedSize.value.height * zoom.value}px`,
  }
  : undefined);

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !viewport.value) return;
  resizeObserver = new ResizeObserver(fitImage);
  resizeObserver.observe(viewport.value);
});

onBeforeUnmount(() => resizeObserver?.disconnect());

watch(() => props.panel.src, () => {
  zoom.value = 1;
  fittedSize.value = { width: 0, height: 0 };
  void nextTick(fitImage);
});

function fitImage(): void {
  const container = viewport.value;
  const element = image.value;
  if (!container || !element || element.naturalWidth <= 0 || element.naturalHeight <= 0) return;
  if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
  const style = getComputedStyle(container);
  const horizontalPadding = pixelValue(style.paddingLeft) + pixelValue(style.paddingRight);
  const verticalPadding = pixelValue(style.paddingTop) + pixelValue(style.paddingBottom);
  const availableWidth = Math.max(1, container.clientWidth - horizontalPadding);
  const availableHeight = Math.max(1, container.clientHeight - verticalPadding);
  const scale = Math.min(1, availableWidth / element.naturalWidth, availableHeight / element.naturalHeight);
  fittedSize.value = {
    width: element.naturalWidth * scale,
    height: element.naturalHeight * scale,
  };
}

function handleWheel(event: WheelEvent): void {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const container = viewport.value;
  const stageElement = stage.value;
  if (!container || !stageElement || fittedSize.value.width <= 0) return;

  const nextZoom = clamp(zoom.value * Math.exp(-event.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === zoom.value) return;
  const rect = stageElement.getBoundingClientRect();
  const anchorX = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5;
  const anchorY = rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0.5;
  zoom.value = nextZoom;

  void nextTick(() => {
    const nextRect = stageElement.getBoundingClientRect();
    container.scrollLeft += nextRect.left + nextRect.width * anchorX - event.clientX;
    container.scrollTop += nextRect.top + nextRect.height * anchorY - event.clientY;
  });
}

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
</script>

<style scoped>
.image-preview-panel {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  background: var(--color-surface-low);
}

.image-preview-panel__viewport {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  overflow: auto;
  padding: var(--space-8);
}

.image-preview-panel__stage {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  margin: auto;
}

.image-preview-panel__stage img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}
</style>
