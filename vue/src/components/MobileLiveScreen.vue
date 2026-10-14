<template>
  <div class="mobile-live-screen">
    <p v-if="error" class="mobile-live-screen__error" role="alert">
      {{ error }}
      <button type="button" @click="connect()">
        {{ $t('surface.mobileSimulator.retry') }}
      </button>
    </p>
    <div
      v-if="source"
      class="mobile-live-screen__device"
      :data-rotation="rotation"
      :data-platform="platform"
      :data-landscape="aspectRatio > 1"
      :style="{ '--mobile-screen-ratio': aspectRatio }"
    >
      <button
        v-for="item in hardwareButtons"
        :key="item.id"
        type="button"
        class="mobile-live-screen__hw"
        :class="`mobile-live-screen__hw--${item.edge}`"
        :style="item.style"
        :aria-label="$t(`surface.mobileSimulator.${item.id}`)"
        :title="$t(`surface.mobileSimulator.${item.id}`)"
        :disabled="disabled"
        @click="$emit('button', item.id)"
      />
      <div class="mobile-live-screen__glass">
      <img
        :src="source"
        :alt="$t('surface.mobileSimulator.screen')"
        tabindex="0"
        draggable="false"
        @load="imageLoaded"
        @error="imageFailed"
        @pointerdown="pointerDown"
        @pointermove="pointerMove"
        @pointerup="pointerUp"
        @pointercancel="pointerUp"
        @lostpointercapture="release"
        @blur="release"
        @keydown="$emit('keydown', $event)"
      />
      </div>
    </div>
    <span v-else-if="!error && !ended">{{ $t('surface.mobileSimulator.reading') }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MobileViewRequest, MobileViewResult } from '@workspace/core/mobile-simulator';
import { appApi } from '../platform-api';
const props = withDefaults(
  defineProps<{
    agentId: string;
    attachmentId: string;
    disabled: boolean;
    /** Frame style: iPhones are much rounder than Android phones. */
    platform?: 'ios' | 'android';
  }>(),
  { platform: 'ios' },
);
defineEmits<{ keydown: [event: KeyboardEvent]; button: [id: HardwareButton] }>();
type HardwareButton = 'volumeUp' | 'volumeDown' | 'power';
type Edge = 'top' | 'right' | 'bottom' | 'left';
const edges: Edge[] = ['top', 'right', 'bottom', 'left'];
/** Physical buttons of an upright phone: edge and extent along it (fractions of the edge, top to bottom). */
const phoneButtons: Record<'ios' | 'android', { id: HardwareButton; edge: Edge; from: number; to: number }[]> = {
  ios: [
    { id: 'volumeUp', edge: 'left', from: 0.2, to: 0.28 },
    { id: 'volumeDown', edge: 'left', from: 0.31, to: 0.39 },
    { id: 'power', edge: 'right', from: 0.27, to: 0.38 },
  ],
  android: [
    { id: 'volumeUp', edge: 'right', from: 0.17, to: 0.235 },
    { id: 'volumeDown', edge: 'right', from: 0.255, to: 0.32 },
    { id: 'power', edge: 'right', from: 0.35, to: 0.42 },
  ],
};
const source = ref('');
const error = ref('');
const ended = ref(false);
const aspectRatio = ref(402 / 874);
/** Clockwise quarter turns applied to the framebuffer (iOS draws a rotated UI inside a portrait buffer). */
const rotation = ref<0 | 1 | 2 | 3>(0);
// iOS turns the image inside a portrait framebuffer; an Android screen turns itself, so landscape is a quarter turn.
const turns = computed(() => (props.platform === 'android' ? (aspectRatio.value > 1 ? 3 : 0) : rotation.value));
const hardwareButtons = computed(() =>
  phoneButtons[props.platform].map((item) => {
    const edge = edges[(edges.indexOf(item.edge) + turns.value) % 4]!;
    // Clockwise and half turns reverse the direction along the edge.
    const flipped = turns.value === 1 || turns.value === 2;
    const start = flipped ? 1 - item.to : item.from;
    const extent = item.to - item.from;
    const along = `${start * 100}%`;
    const length = `${extent * 100}%`;
    return {
      id: item.id,
      edge,
      style: edge === 'left' || edge === 'right' ? { top: along, height: length } : { left: along, width: length },
    };
  }),
);
let generation = 0;
let recoveryAvailable = true;
let resumeOnVisible = false;
let lastReadAt = 0;
let width = 0,
  height = 0;
let geometry = 0;
let loaded: (() => void) | undefined;
let stopView: (() => void) | undefined;
let send:
  | ((
      input:
        | { action: 'frame' | 'stop' }
        | {
            action: 'touch';
            phase: 'down' | 'move' | 'up';
            x: number;
            y: number;
            geometry: number;
          },
    ) => Promise<MobileViewResult>)
  | undefined;
type Point = { x: number; y: number; geometry: number };
let gesture: { pointerId: number; point: Point } | undefined;
let pendingDown: Point | undefined;
let pendingMove: Point | undefined;
let pendingUp: Point | undefined;
let sending = false;

function stop() {
  generation++;
  stopView?.();
  stopView = undefined;
  send = undefined;
  gesture = pendingDown = pendingMove = pendingUp = undefined;
  sending = false;
  loaded?.();
  loaded = undefined;
  if (source.value) URL.revokeObjectURL(source.value);
  source.value = '';
}
function fail(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const detail = message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
  if (recoveryAvailable && detail === 'Simulator view expired. Reconnect the view.') {
    recoveryAvailable = false;
    void connect(true);
    return;
  }
  stop();
  error.value = detail;
}
function imageLoaded(event: Event) {
  if ((event.target as HTMLImageElement).getAttribute('src') === source.value) loaded?.();
}
function imageFailed(event: Event) {
  if ((event.target as HTMLImageElement).getAttribute('src') === source.value) {
    fail(new Error('Could not display simulator video.'));
  }
}
async function connect(recovering = false) {
  stop();
  error.value = '';
  ended.value = false;
  if (!recovering) recoveryAvailable = true;
  resumeOnVisible = document.visibilityState === 'hidden';
  if (resumeOnVisible) return;
  const identity = generation;
  const agentId = props.agentId,
    attachmentId = props.attachmentId;
  const api = appApi?.mobileSimulatorView;
  if (!api) {
    fail(new Error('Live simulator video requires the desktop app.'));
    return;
  }
  try {
    const started = await api(agentId, { action: 'start', attachmentId });
    const { viewId } = started;
    if (started.ended) {
      if (identity === generation) ended.value = true;
      return;
    }
    const request = (input: Omit<MobileViewRequest, 'attachmentId' | 'viewId'>) =>
      api(agentId, { ...input, attachmentId, viewId } as MobileViewRequest);
    const dispose = () => {
      void request({ action: 'stop' }).catch(() => undefined);
    };
    if (identity !== generation) {
      dispose();
      return;
    }
    stopView = dispose;
    send = request;
    while (identity === generation) {
      lastReadAt = Date.now();
      const result = await request({ action: 'frame' });
      if (identity !== generation) return;
      if (result.viewId !== viewId) throw new Error('Invalid simulator video frame.');
      if (result.ended) {
        stop();
        ended.value = true;
        return;
      }
      if (!result.frame) continue; // Native Android streams remain silent on an unchanged screen.
      rotation.value = result.frame.rotation ?? 0;
      aspectRatio.value =
        rotation.value % 2 ? result.frame.height / result.frame.width : result.frame.width / result.frame.height;
      const previous = source.value;
      const displayed = new Promise<void>((resolve) => {
        loaded = resolve;
      });
      source.value = URL.createObjectURL(
        new Blob([new Uint8Array(result.frame.data)], { type: result.frame.mimeType }),
      );
      await displayed;
      if (identity === generation) {
        recoveryAvailable = true;
        geometry = result.frame.geometry;
        width = result.frame.width;
        height = result.frame.height;
      }
      if (previous) URL.revokeObjectURL(previous);
    }
  } catch (cause) {
    if (identity === generation) fail(cause);
  }
}
function point(event: PointerEvent): Point | undefined {
  const rect = (event.currentTarget as HTMLImageElement).getBoundingClientRect();
  if (!rect.width || !rect.height || !width || !height) return;
  // The device takes touches in its upright (displayed) space, so a turned iOS framebuffer swaps its axes.
  const turned = rotation.value % 2 === 1;
  const displayedWidth = turned ? height : width;
  const displayedHeight = turned ? width : height;
  return {
    geometry,
    x: Math.max(0, Math.min(displayedWidth - 1, Math.round(((event.clientX - rect.left) * displayedWidth) / rect.width))),
    y: Math.max(0, Math.min(displayedHeight - 1, Math.round(((event.clientY - rect.top) * displayedHeight) / rect.height))),
  };
}
function pointerDown(event: PointerEvent) {
  if (props.disabled || gesture || pendingUp || sending || event.button !== 0 || !send) return;
  const start = point(event);
  if (!start) return;
  event.preventDefault();
  (event.currentTarget as HTMLImageElement).focus();
  (event.currentTarget as HTMLImageElement).setPointerCapture?.(event.pointerId);
  gesture = { pointerId: event.pointerId, point: start };
  pendingDown = start;
  void flushTouch();
}
function pointerMove(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const next = point(event);
  if (!next) return;
  gesture.point = next;
  pendingMove = next;
  void flushTouch();
}
function pointerUp(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gesture.point = point(event) ?? gesture.point;
  release();
}
function release() {
  if (!gesture) return;
  pendingUp = gesture.point;
  pendingMove = undefined;
  gesture = undefined;
  void flushTouch();
}
async function flushTouch() {
  if (sending || !send) return;
  sending = true;
  const identity = generation,
    request = send;
  try {
    while (identity === generation) {
      let phase: 'down' | 'move' | 'up';
      let next: Point;
      if (pendingDown) {
        phase = 'down';
        next = pendingDown;
        pendingDown = undefined;
      } else if (pendingUp) {
        phase = 'up';
        next = pendingUp;
        pendingUp = undefined;
      } else if (pendingMove) {
        phase = 'move';
        next = pendingMove;
        pendingMove = undefined;
      } else break;
      await request({ action: 'touch', phase, ...next });
    }
  } catch (cause) {
    if (identity === generation) fail(cause);
  } finally {
    if (identity === generation) sending = false;
  }
}
watch(
  () => [props.agentId, props.attachmentId],
  () => void connect(),
  { immediate: true },
);
function resumeAfterPause() {
  // The host reclaims unread video after 15s. Focus also covers sleep or a stalled image load.
  if (document.visibilityState !== 'hidden' && send && recoveryAvailable && Date.now() - lastReadAt >= 15_000) {
    recoveryAvailable = false;
    void connect(true);
  }
}
function visibilityChanged() {
  if (document.visibilityState === 'hidden') {
    resumeOnVisible = !error.value && !ended.value;
    stop();
  } else if (resumeOnVisible) {
    void connect();
  }
}
onMounted(() => {
  window.addEventListener('focus', resumeAfterPause);
  document.addEventListener('visibilitychange', visibilityChanged);
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', resumeAfterPause);
  document.removeEventListener('visibilitychange', visibilityChanged);
  stop();
});
</script>

<style scoped>
.mobile-live-screen {
  container-type: size;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.mobile-live-screen__device {
  --mobile-screen-ratio: calc(402 / 874);
  --mobile-screen-width: min(calc(100cqw - 40px), calc((100cqh - 40px) * var(--mobile-screen-ratio)));
  --mobile-screen-radius: calc(min(var(--mobile-screen-width), var(--mobile-screen-width) / var(--mobile-screen-ratio)) * var(--mobile-corner, 0.14));
  position: relative;
  flex: none;
  box-sizing: content-box;
  width: var(--mobile-screen-width);
  padding: 5px;
  border: 2px solid var(--color-border-strong);
  border-radius: calc(var(--mobile-screen-radius) + 7px);
  background: var(--color-text);
  box-shadow: var(--shadow-lg);
}
.mobile-live-screen__device::before,
.mobile-live-screen__device::after {
  position: absolute;
  border-radius: 2px;
  background: var(--color-border-strong);
  content: '';
}
/* Android phones have tighter corners than iPhones. */
.mobile-live-screen__device[data-platform='android'] {
  --mobile-corner: 0.055;
}
/* Side buttons: a thin bar on the frame, with a larger invisible hit area, that pushes in when pressed. */
.mobile-live-screen__hw {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.mobile-live-screen__hw::before {
  position: absolute;
  border-radius: 2px;
  background: var(--color-border-strong);
  content: '';
  transition:
    background 0.12s,
    transform 0.12s,
    inset 0.12s,
    width 0.12s,
    height 0.12s;
}
.mobile-live-screen__hw:hover:not(:disabled)::before,
.mobile-live-screen__hw:focus-visible::before {
  background: var(--color-text-muted);
}
.mobile-live-screen__hw:disabled {
  cursor: default;
}
/* Hovering swells the bar, thicker and slightly longer, as a larger target. */
.mobile-live-screen__hw--left:hover:not(:disabled)::before,
.mobile-live-screen__hw--right:hover:not(:disabled)::before,
.mobile-live-screen__hw--left:focus-visible::before,
.mobile-live-screen__hw--right:focus-visible::before {
  top: -3px;
  bottom: -3px;
  width: 6px;
}
.mobile-live-screen__hw--top:hover:not(:disabled)::before,
.mobile-live-screen__hw--bottom:hover:not(:disabled)::before,
.mobile-live-screen__hw--top:focus-visible::before,
.mobile-live-screen__hw--bottom:focus-visible::before {
  right: -3px;
  left: -3px;
  height: 6px;
}
.mobile-live-screen__hw--left {
  left: -14px;
  width: 12px;
}
.mobile-live-screen__hw--right {
  right: -14px;
  width: 12px;
}
.mobile-live-screen__hw--top {
  top: -14px;
  height: 12px;
}
.mobile-live-screen__hw--bottom {
  bottom: -14px;
  height: 12px;
}
.mobile-live-screen__hw--left::before {
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
}
.mobile-live-screen__hw--right::before {
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
}
.mobile-live-screen__hw--top::before {
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
}
.mobile-live-screen__hw--bottom::before {
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
}
.mobile-live-screen__hw--left:active:not(:disabled)::before {
  transform: translateX(2px);
}
.mobile-live-screen__hw--right:active:not(:disabled)::before {
  transform: translateX(-2px);
}
.mobile-live-screen__hw--top:active:not(:disabled)::before {
  transform: translateY(2px);
}
.mobile-live-screen__hw--bottom:active:not(:disabled)::before {
  transform: translateY(-2px);
}
.mobile-live-screen__glass {
  position: relative;
  width: 100%;
  aspect-ratio: var(--mobile-screen-ratio);
  overflow: hidden;
  border-radius: var(--mobile-screen-radius);
}
.mobile-live-screen img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  touch-action: none;
  user-select: none;
  /* The browser's ring would be drawn around the square image and clipped by the screen's corners. */
  outline: none;
}
.mobile-live-screen__device:has(img:focus-visible) {
  box-shadow:
    var(--shadow-lg),
    0 0 0 2px var(--color-primary);
}
.mobile-live-screen__device[data-rotation='1'] img,
.mobile-live-screen__device[data-rotation='3'] img {
  position: absolute;
  top: 50%;
  left: 50%;
  /* Unrotated box: its width becomes the visible height. */
  width: calc(var(--mobile-screen-width) / var(--mobile-screen-ratio));
  height: var(--mobile-screen-width);
}
.mobile-live-screen__device[data-rotation='1'] img {
  transform: translate(-50%, -50%) rotate(90deg);
}
.mobile-live-screen__device[data-rotation='2'] img {
  transform: rotate(180deg);
}
.mobile-live-screen__device[data-rotation='3'] img {
  transform: translate(-50%, -50%) rotate(270deg);
}
.mobile-live-screen__error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-6);
  color: var(--color-error);
  font-size: var(--font-size-13);
}
.mobile-live-screen__error button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
