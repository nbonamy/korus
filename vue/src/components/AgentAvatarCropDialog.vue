<template>
  <el-dialog
    class="app-dialog agent-avatar-crop-dialog"
    :model-value="visible"
    :teleported="false"
    width="320px"
    :show-close="false"
    destroy-on-close
    @update:model-value="onVisibilityChanged"
  >
    <template #header>
      <div class="app-dialog__header">
        <h2 class="app-dialog__title">{{ title }}</h2>
      </div>
    </template>

    <div class="agent-avatar-crop-dialog__body">
      <div class="agent-avatar-crop-dialog__stage" :class="{ 'agent-avatar-crop-dialog__stage--square': shape === 'square' }">
        <img
          v-if="image"
          :src="image"
          alt=""
          :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
          draggable="false"
          @load="onImageLoaded"
          @pointercancel="stopPanning"
          @pointerdown="startPanning"
          @pointermove="panImage"
          @pointerup="stopPanning"
        />
      </div>

      <input
        v-model.number="zoom"
        class="agent-avatar-crop-dialog__range"
        type="range"
        min="1"
        max="3"
        step="0.05"
      />
    </div>

    <template #footer>
      <div class="app-dialog__footer">
        <button class="app-button app-button--tertiary" type="button" @click="emit('cancel')">{{ $t('surface.agentAvatarCropDialog.cancel') }}</button>
        <button
          class="app-button app-button--primary"
          type="button"
          @click="apply"
        > {{ $t('surface.agentAvatarCropDialog.useImage') }} </button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { ref, watch } from 'vue';
import { clampAvatarCropPan, cropImageDataUrl, type AvatarCropPan } from './agent-avatar-crop';

const props = withDefaults(defineProps<{
  image: string | null;
  title?: string;
  shape?: 'circle' | 'square';
  visible: boolean;
}>(), {
  title: translate('surface.agentAvatarCropDialog.adjustAvatar'),
  shape: 'circle',
});

const emit = defineEmits<{
  apply: [avatar: string];
  cancel: [];
}>();

const stageSize = 200;
const zoom = ref(1);
const imageSize = ref<{ height: number; width: number } | null>(null);
const pan = ref<AvatarCropPan>({ x: 0, y: 0 });
const dragStart = ref<{
  pan: AvatarCropPan;
  pointerId: number;
  x: number;
  y: number;
} | null>(null);

watch(() => props.visible, (visible) => {
  if (visible) {
    resetCrop();
  }
});

watch(() => props.image, () => {
  resetCrop();
  imageSize.value = null;
});

watch(zoom, () => {
  pan.value = clampAvatarCropPan(pan.value, imageSize.value, zoom.value, stageSize);
});

async function apply(): Promise<void> {
  if (!props.image) {
    return;
  }

  emit('apply', await cropImageDataUrl(props.image, zoom.value, pan.value, stageSize));
}

function resetCrop(): void {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
  dragStart.value = null;
}

function onImageLoaded(event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  imageSize.value = {
    height: image.naturalHeight || image.height,
    width: image.naturalWidth || image.width,
  };
  pan.value = clampAvatarCropPan(pan.value, imageSize.value, zoom.value, stageSize);
}

function startPanning(event: PointerEvent): void {
  if (!imageSize.value) {
    return;
  }

  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  if (typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(event.pointerId);
  }
  dragStart.value = {
    pan: { ...pan.value },
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
}

function panImage(event: PointerEvent): void {
  if (!dragStart.value || dragStart.value.pointerId !== event.pointerId) {
    return;
  }

  pan.value = clampAvatarCropPan({
    x: dragStart.value.pan.x + event.clientX - dragStart.value.x,
    y: dragStart.value.pan.y + event.clientY - dragStart.value.y,
  }, imageSize.value, zoom.value, stageSize);
}

function stopPanning(event: PointerEvent): void {
  if (dragStart.value?.pointerId === event.pointerId) {
    dragStart.value = null;
  }
}

function onVisibilityChanged(nextVisible: boolean): void {
  if (!nextVisible) {
    emit('cancel');
  }
}
</script>

<style scoped>
.agent-avatar-crop-dialog__body {
  display: grid;
  justify-items: center;
  gap: var(--space-16);
}

.agent-avatar-crop-dialog__stage {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--color-surface-base);
  cursor: grab;
  user-select: none;
}

.agent-avatar-crop-dialog__stage--square {
  border-radius: var(--radius-md);
}

.agent-avatar-crop-dialog__stage img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform-origin: center;
  touch-action: none;
}

.agent-avatar-crop-dialog__stage img:active {
  cursor: grabbing;
}

.agent-avatar-crop-dialog__range {
  width: 220px;
  max-width: 100%;
}
</style>
