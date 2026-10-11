<template>
  <section class="browser-panel" :aria-label="$t('surface.browserPanel.inAppBrowser')">
    <header class="browser-panel__toolbar" :class="{ 'browser-panel__toolbar--visualization': visualization }">
      <div v-if="!visualization" class="browser-panel__navigation" :aria-label="$t('surface.browserPanel.browserNavigation')">
        <button type="button" :aria-label="$t('surface.browserPanel.goBack')" :title="$t('surface.browserPanel.goBack')" :disabled="!state.canGoBack || loading" @click="goBack"><IconArrowLeft /></button>
        <button type="button" :aria-label="$t('surface.browserPanel.goForward')" :title="$t('surface.browserPanel.goForward')" :disabled="!state.canGoForward || loading" @click="goForward"><IconArrowRight /></button>
        <button type="button" :aria-label="$t('surface.browserPanel.reloadPage')" :title="$t('surface.browserPanel.reload')" :disabled="loading" @click="reload"><IconRefresh /></button>
      </div>
      <form v-if="!annotationMode && !visualization" class="browser-panel__address" @submit.prevent="navigate">
        <input ref="addressInput" v-model="address" :aria-label="$t('surface.browserPanel.browserAddress')" spellcheck="false" :title="state.title || address" />
        <BrowserBookmarks :active="visible" :bookmarks="bookmarks" :url="state.url" :title="state.title" :save="saveBookmarks" @open="openBookmark" />
        <button
          v-if="externalUrl"
          class="browser-panel__external-open"
          type="button"
          :aria-label="$t('surface.browserPanel.openInExternalBrowser')"
          :title="$t('surface.browserPanel.openInExternalBrowser')"
          @click="openExternal"
        ><ArrowUpRightIcon aria-hidden="true" /></button>
      </form>
      <div v-else-if="visualization" class="browser-panel__visualization-title">{{ visualization.title }}</div>
      <div v-else class="browser-panel__annotation-title"><strong>{{ $t('surface.browserPanel.annotating') }}</strong><span>•</span><span>{{ displayHost }}</span></div>
      <div class="browser-panel__actions">
        <button v-if="!visualization" class="browser-panel__annotate" type="button" :aria-label="annotationMode ? $t('surface.browserPanel.exitAnnotationMode') : $t('surface.browserPanel.annotatePage')" :title="annotationMode ? $t('surface.browserPanel.exitAnnotationMode') : $t('surface.browserPanel.annotatePage')" :aria-pressed="annotationMode" @click="toggleAnnotation"><IconX v-if="annotationMode" /><IconCirclePlus v-else /></button>
        <AnnotationSendButton
          v-if="annotations.length"
          :count="annotations.length"
          :label="$t('dynamic.annotation.send', { count: annotations.length })"
          @click="sendAnnotations"
        />
        <button ref="menuTrigger" type="button" :aria-label="$t('surface.browserPanel.browserMenu')" :title="$t('surface.browserPanel.browserMenu')" :aria-expanded="menuOpen" @click="toggleMenu"><IconDotsVertical /></button>
        <div v-if="menuOpen" ref="menuRoot" class="browser-panel__menu">
          <div class="browser-panel__zoom" role="group" :aria-label="$t('surface.browserPanel.zoom')">
            <IconZoom class="browser-panel__zoom-icon" aria-hidden="true" />
            <span>{{ $t('surface.browserPanel.zoom') }}</span>
            <div class="browser-panel__zoom-actions">
              <button type="button" :aria-label="$t('surface.browserPanel.zoomOut')" :disabled="zoomPercent <= 50 || !browserReadyForControls || zoomPending" @click="changeZoom(-1)"><IconMinus /></button>
              <span>{{ zoomPercent }}%</span>
              <button type="button" :aria-label="$t('surface.browserPanel.zoomIn')" :disabled="zoomPercent >= 300 || !browserReadyForControls || zoomPending" @click="changeZoom(1)"><IconPlus /></button>
            </div>
            <button type="button" :aria-label="$t('surface.browserPanel.resetZoom')" :disabled="zoomPercent === 100 || !browserReadyForControls || zoomPending" @click="setZoom(100)"><IconRefresh /></button>
          </div>
          <AppMenu class="app-menu--embedded" :ariaLabel="$t('surface.browserPanel.browserMenu')" :items="menuItems" @select="selectMenuAction" />
        </div>
      </div>
    </header>
    <div v-if="deviceToolbarVisible && !visualization" class="browser-panel__device-toolbar">
      <label>
        {{ $t('surface.browserPanel.dimensions') }}
        <select v-model="devicePreset" :aria-label="$t('surface.browserPanel.deviceMode')" @change="selectDevicePreset">
          <option value="responsive">{{ $t('surface.browserPanel.responsive') }}</option>
          <option value="custom">{{ $t('surface.browserPanel.custom') }}</option>
          <option value="phone">{{ $t('surface.browserPanel.phone') }}</option>
          <option value="tablet">{{ $t('surface.browserPanel.tablet') }}</option>
          <option value="desktop">{{ $t('surface.browserPanel.desktop') }}</option>
        </select>
      </label>
      <div class="browser-panel__dimensions">
        <input type="number" min="240" max="2000" :value="deviceWidth" :aria-label="$t('surface.browserPanel.viewportWidth')" @change="setDeviceDimension('width', $event)" />
        <span aria-hidden="true">×</span>
        <input type="number" min="320" max="2000" :value="deviceHeight" :aria-label="$t('surface.browserPanel.viewportHeight')" @change="setDeviceDimension('height', $event)" />
      </div>
      <button type="button" :aria-label="$t('surface.browserPanel.rotateViewport')" :title="$t('surface.browserPanel.rotateViewport')" @click="rotateDevice"><IconRotateRectangle /></button>
      <span class="browser-panel__device-zoom">{{ zoomPercent }}%</span>
      <button type="button" :aria-label="$t('surface.browserPanel.hideDeviceToolbar')" :title="$t('surface.browserPanel.hideDeviceToolbar')" @click="deviceToolbarVisible = false"><IconX /></button>
    </div>
    <p v-if="error" class="browser-panel__error" role="alert">{{ error }}</p>
    <div class="browser-panel__surface">
      <div ref="viewport" class="browser-panel__viewport" :class="{ 'browser-panel__viewport--device': deviceToolbarVisible, 'browser-panel__viewport--responsive': deviceToolbarVisible && devicePreset === 'responsive' }" @scroll="syncBounds">
        <div ref="guestFrame" class="browser-panel__guest-frame" :style="guestFrameStyle">
          <div
            v-if="capturingArea"
            class="browser-panel__capture-overlay"
            :aria-label="$t('surface.browserPanel.selectScreenshotArea')"
            @pointerdown="startAreaSelection"
            @pointermove="moveAreaSelection"
            @pointerup="finishAreaSelection"
            @pointercancel="cancelAreaSelection"
          >
            <span v-if="!selectionRect" class="browser-panel__capture-hint">{{ $t('surface.browserPanel.dragToCapture') }}</span>
            <div v-if="selectionRect" class="browser-panel__capture-selection" :style="selectionStyle" />
          </div>
        </div>
      </div>
    </div>

  </section>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { IconArrowLeft, IconArrowRight, IconCamera, IconCirclePlus, IconCrop, IconDeviceMobile, IconDotsVertical, IconMinus, IconPlus, IconRefresh, IconRotateRectangle, IconX, IconZoom } from '@tabler/icons-vue';
import { PRIMARY_BROWSER_ID, type BrowserAnnotation, type BrowserBounds, type BrowserState, type BrowserViewportBounds, type MainToRendererEvent } from '@workspace/core/contracts';
import { browserGuestPartition } from '@workspace/core/browser-guest';
import { browserDevicePresets, type BrowserViewportRequest } from '@workspace/core/browser-viewport';
import { appClientPlatform, appApi } from '../platform-api';
import { ArrowUpRightIcon } from '../shared/icons/app-icons';
import AnnotationSendButton from './AnnotationSendButton.vue';
import AppMenu from '../shared/menu/AppMenu.vue';
import type { AppMenuItem } from '../shared/menu/app-menu';
import { externalBrowserUrl, openInExternalBrowser } from './browser-external';
import BrowserBookmarks from './BrowserBookmarks.vue';
import { normalizeBrowserBookmarks, type BrowserBookmark } from '@workspace/core/browser-bookmarks';
import { useAppState } from '../app-state';

const appState = useAppState();
const bookmarks = computed(() => normalizeBrowserBookmarks(appState.snapshot.value.general.browserBookmarks));
async function saveBookmarks(bookmarks: BrowserBookmark[]): Promise<void> {
  await appState.updateSettings({ general: { browserBookmarks: bookmarks } });
}
async function openBookmark(url: string): Promise<void> {
  address.value = url;
  await navigate();
}

const props = withDefaults(defineProps<{
  agentId: string;
  browserId?: string;
  initialUrl?: string;
  openRequestId?: number;
  visible?: boolean;
  visualization?: { path: string; title: string } | null;
}>(), {
  initialUrl: '',
  browserId: PRIMARY_BROWSER_ID,
  openRequestId: 0,
  visible: true,
  visualization: null,
});
const emit = defineEmits<{ 'send-prompt': [prompt: string]; 'url-change': [url: string] }>();

const menuTrigger = ref<HTMLElement | null>(null);
const menuRoot = ref<HTMLElement | null>(null);
const viewport = ref<HTMLElement | null>(null);
const guestFrame = ref<HTMLElement | null>(null);
const addressInput = ref<HTMLInputElement | null>(null);
const address = ref(props.initialUrl ?? '');
const loading = ref(true);
const error = ref<string | null>(null);
const annotationMode = ref(false);
const annotations = ref<BrowserAnnotation[]>([]);
const state = ref<BrowserState>({ url: '', title: '', canGoBack: false, canGoForward: false });
const menuOpen = ref(false);
const zoomPercent = ref(100);
const zoomPending = ref(false);
const zoomSteps = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const deviceToolbarVisible = ref(false);
const devicePreset = ref('responsive');
const deviceWidth = ref(390);
const deviceHeight = ref(844);
const capturingArea = ref(false);
const screenshotPending = ref(false);
const selectionStart = ref<{ x: number; y: number } | null>(null);
const selectionRect = ref<BrowserBounds | null>(null);
let browserReady = false;
let initializing = true;
let guestElement: (HTMLElement & { getWebContentsId?: () => number }) | null = null;
let guestWebContentsId: number | null = null;
let guestPartition: string | null = null;
let disposed = false;
let zoomRequestId = 0;
const displayHost = computed(() => {
  try {
    return new URL(state.value.url || address.value).host;
  } catch {
    return address.value;
  }
});
const externalUrl = computed(() => props.visualization ? null : externalBrowserUrl(state.value.url));
const browserReadyForControls = computed(() => browserReady && !loading.value);
const menuItems = computed<AppMenuItem[]>(() => [
  ...(!props.visualization ? [{ id: 'device-toolbar', type: 'action', label: translate(deviceToolbarVisible.value ? 'surface.browserPanel.hideDeviceToolbar' : 'surface.browserPanel.showDeviceToolbar'), icon: IconDeviceMobile } satisfies AppMenuItem] : []),
  ...(!props.visualization ? [{ id: 'screenshot-divider', type: 'separator' } satisfies AppMenuItem] : []),
  { id: 'screenshot', type: 'action', label: translate('surface.browserPanel.screenshot'), icon: IconCamera, disabled: !browserReadyForControls.value || screenshotPending.value },
  { id: 'screenshot-area', type: 'action', label: translate('surface.browserPanel.screenshotArea'), icon: IconCrop, disabled: !browserReadyForControls.value || screenshotPending.value },
]);
const guestFrameStyle = computed(() => deviceToolbarVisible.value && devicePreset.value !== 'responsive' && !props.visualization
  ? { width: `${deviceWidth.value}px`, height: `${deviceHeight.value}px` }
  : undefined);
const selectionStyle = computed(() => selectionRect.value ? {
  left: `${selectionRect.value.x}px`, top: `${selectionRect.value.y}px`,
  width: `${selectionRect.value.width}px`, height: `${selectionRect.value.height}px`,
} : undefined);
let resizeObserver: ResizeObserver | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeCommands: (() => void) | null = null;

watch(() => state.value.url, (url) => emit('url-change', url), { immediate: true });

onMounted(async () => {
  const initialRequestId = props.openRequestId;
  unsubscribe = appApi?.onEvent(handleEvent) ?? null;
  unsubscribeCommands = appApi?.onAppCommand(command => {
    if (command.type === 'set-browser-viewport' && command.agentId === props.agentId && command.browserId === props.browserId) {
      void applyViewportRequest(command).catch(reason => { error.value = messageFor(reason); });
    }
  }) ?? null;
  resizeObserver = new ResizeObserver(() => {
    updateResponsiveDimensions();
    void syncBounds();
  });
  window.addEventListener('resize', syncBoundsAfterWindowResize);
  document.addEventListener('pointerdown', closeMenuOnOutsideClick);
  window.addEventListener('keydown', handleEscape);
  if (viewport.value) resizeObserver.observe(viewport.value);
  if (guestFrame.value) resizeObserver.observe(guestFrame.value);
  try {
    await runNavigation(openInitialContent);
    if (browserReady && !props.visible) await appApi?.browserSetVisible(props.agentId, props.browserId, false);
  } catch (reason) {
    error.value = messageFor(reason);
  } finally {
    initializing = false;
    if (!disposed && props.openRequestId !== initialRequestId) await openRequestedContent();
    await nextTick();
    await syncBounds();
  }
});

onBeforeUnmount(() => {
  disposed = true;
  unsubscribe?.();
  unsubscribeCommands?.();
  resizeObserver?.disconnect();
  window.removeEventListener('resize', syncBoundsAfterWindowResize);
  document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
  window.removeEventListener('keydown', handleEscape);
  guestElement?.remove();
  guestElement = null;
  void appApi?.browserClose(props.agentId, props.browserId);
});

watch(() => props.visible, async (visible) => {
  if (!appApi || !browserReady) return;
  await appApi.browserSetVisible(props.agentId, props.browserId, visible);
  if (visible) {
    await nextTick();
    await syncBounds();
  }
});

watch(() => props.openRequestId, async (requestId, previousRequestId) => {
  if (!requestId || requestId === previousRequestId) return;
  if (initializing || disposed) return;
  await openRequestedContent();
});

async function openRequestedContent(): Promise<void> {
  if (props.visualization || !props.initialUrl) {
    await runNavigation(openInitialContent);
    return;
  }
  address.value = props.initialUrl;
  await navigate();
}

async function openInitialContent(): Promise<BrowserState> {
  const api = requireBrowserApi();
  const guestId = await ensureGuest();
  if (props.visualization) {
    return api.browserOpenVisualization(
      props.agentId,
      props.browserId,
      props.visualization.path,
      props.visualization.title,
      guestId,
    );
  }
  address.value = props.initialUrl;
  return api.browserOpen(props.agentId, props.browserId, address.value, guestId);
}

async function ensureGuest(): Promise<number> {
  if (appClientPlatform !== 'desktop') throw new Error(translate('surface.browserPanel.browserIsUnavailable'));
  const partition = browserGuestPartition(props.agentId, Boolean(props.visualization));
  if (guestElement && guestPartition === partition && guestWebContentsId != null) return guestWebContentsId;
  guestElement?.remove();
  const guest = document.createElement('webview') as HTMLElement & { getWebContentsId?: () => number };
  guest.className = 'browser-panel__guest';
  guest.setAttribute('partition', partition);
  guest.setAttribute('src', 'about:blank');
  guest.addEventListener('did-navigate', handleGuestNavigation);
  guest.addEventListener('did-navigate-in-page', handleGuestNavigation);
  guest.addEventListener('focus', () => { menuOpen.value = false; });
  guestElement = guest;
  guestPartition = partition;
  guestWebContentsId = null;
  return new Promise<number>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      guest.removeEventListener('dom-ready', ready);
      reject(new Error('Browser page did not attach.'));
    }, 10_000);
    const ready = (): void => {
      if (disposed) return;
      let id: number | undefined;
      try {
        id = guest.getWebContentsId?.();
      } catch (reason) {
        window.clearTimeout(timeout);
        guest.removeEventListener('dom-ready', ready);
        reject(reason);
        return;
      }
      if (typeof id !== 'number' || id <= 0) return;
      window.clearTimeout(timeout);
      guest.removeEventListener('dom-ready', ready);
      guestWebContentsId = id;
      resolve(id);
    };
    guest.addEventListener('dom-ready', ready);
    guestFrame.value?.append(guest);
  });
}

function handleGuestNavigation(event: Event): void {
  const navigation = event as Event & { url?: string; isMainFrame?: boolean };
  if (!browserReady || props.visualization || !navigation.url || navigation.url === 'about:blank'
    || navigation.isMainFrame === false) return;
  state.value = { ...state.value, url: navigation.url };
  if (document.activeElement !== addressInput.value) address.value = navigation.url;
  void syncZoom();
}

async function openExternal(): Promise<void> {
  if (!externalUrl.value) return;
  try {
    await openInExternalBrowser(externalUrl.value);
  } catch (reason) {
    error.value = messageFor(reason);
  }
}

async function navigate(): Promise<void> {
  const input = address.value.trim();
  const localAddress = /^(?:localhost|127(?:\.\d+){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input);
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  const looksLikeHost = /^(?:[^\s/:]+\.)+[^\s/:]+(?::\d+)?(?:[/?#]|$)/u.test(input);
  const target = localAddress ? `http://${input}`
    : !/\s/u.test(input) && looksLikeHost ? (explicitScheme ? `https://${input}` : input)
    : !input || explicitScheme ? input
      : `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  await runNavigation(async () => browserReady
    ? requireBrowserApi().browserNavigate(props.agentId, props.browserId, target)
    : requireBrowserApi().browserOpen(props.agentId, props.browserId, target, await ensureGuest()));
}

async function goBack(): Promise<void> {
  await runNavigation(() => requireBrowserApi().browserGoBack(props.agentId, props.browserId));
}

async function goForward(): Promise<void> {
  await runNavigation(() => requireBrowserApi().browserGoForward(props.agentId, props.browserId));
}

async function reload(): Promise<void> {
  await runNavigation(() => requireBrowserApi().browserReload(props.agentId, props.browserId));
}

async function setZoom(percent: number): Promise<void> {
  if (zoomPending.value) return;
  const requestId = ++zoomRequestId;
  zoomPending.value = true;
  try {
    const actualPercent = await requireBrowserApi().browserSetZoom(props.agentId, props.browserId, percent);
    if (requestId === zoomRequestId) zoomPercent.value = actualPercent;
    error.value = null;
  } catch (reason) {
    error.value = messageFor(reason);
  } finally {
    zoomPending.value = false;
  }
}

async function changeZoom(direction: -1 | 1): Promise<void> {
  const next = direction === 1
    ? zoomSteps.find((step) => step > zoomPercent.value)
    : [...zoomSteps].reverse().find((step) => step < zoomPercent.value);
  if (next !== undefined) await setZoom(next);
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value && browserReady) void syncZoom();
}

async function syncZoom(): Promise<void> {
  const requestId = ++zoomRequestId;
  try {
    const actualPercent = await requireBrowserApi().browserGetZoom(props.agentId, props.browserId);
    if (!disposed && requestId === zoomRequestId) zoomPercent.value = actualPercent;
  } catch (reason) {
    if (!disposed && requestId === zoomRequestId) error.value = messageFor(reason);
  }
}

async function selectMenuAction(itemId: string): Promise<void> {
  menuOpen.value = false;
  if (itemId === 'device-toolbar') {
    deviceToolbarVisible.value = !deviceToolbarVisible.value;
    await nextTick();
    updateResponsiveDimensions();
    await syncBounds();
  } else if (itemId === 'screenshot') {
    await copyScreenshot();
  } else if (itemId === 'screenshot-area') {
    capturingArea.value = true;
    selectionRect.value = null;
  }
}

function updateResponsiveDimensions(): void {
  if (!deviceToolbarVisible.value || devicePreset.value !== 'responsive' || !viewport.value) return;
  deviceWidth.value = viewport.value.clientWidth;
  deviceHeight.value = viewport.value.clientHeight;
}

async function selectDevicePreset(): Promise<void> {
  if (devicePreset.value === 'responsive') {
    await nextTick();
    updateResponsiveDimensions();
    return;
  }
  const preset = browserDevicePresets[devicePreset.value as keyof typeof browserDevicePresets];
  if (!preset) return;
  deviceWidth.value = preset.width;
  deviceHeight.value = preset.height;
}

function setDeviceDimension(dimension: 'width' | 'height', event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  const min = dimension === 'width' ? 240 : 320;
  const max = 2000;
  if (!Number.isFinite(value)) return;
  const clamped = Math.max(min, Math.min(max, Math.round(value)));
  if (dimension === 'width') deviceWidth.value = clamped;
  else deviceHeight.value = clamped;
  input.value = String(clamped);
  devicePreset.value = 'custom';
}

function rotateDevice(): void {
  [deviceWidth.value, deviceHeight.value] = [deviceHeight.value, deviceWidth.value];
  devicePreset.value = 'custom';
}

async function applyViewportRequest(request: BrowserViewportRequest): Promise<void> {
  const api = requireBrowserApi();
  let failure: string | undefined;
  try {
    if (!browserReady || disposed || !props.visible || props.visualization) throw new Error('Open this agent’s Browser pane before changing its viewport.');
    const configuration = request.viewport;
    deviceToolbarVisible.value = configuration.preset !== 'fit';
    devicePreset.value = configuration.preset === 'fit' ? 'responsive' : configuration.preset;
    if (configuration.preset === 'custom') {
      deviceWidth.value = configuration.width!;
      deviceHeight.value = configuration.height!;
    } else await selectDevicePreset();
    await nextTick();
    // Let the renderer and embedded webview receive the changed layout before measuring.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (disposed || !props.visible) throw new Error('Browser pane is no longer visible.');
    updateResponsiveDimensions();
    await syncBounds();
    await syncZoom();
  } catch (reason) { failure = messageFor(reason); }
  await api.browserViewportApplied(props.agentId, props.browserId, request.requestId, failure);
}

async function copyScreenshot(rect?: BrowserBounds): Promise<void> {
  if (screenshotPending.value) return;
  screenshotPending.value = true;
  try {
    await requireBrowserApi().browserCopyScreenshot(props.agentId, props.browserId, rect);
    ElMessage.success(translate('surface.browserPanel.screenshotCopied'));
    error.value = null;
  } catch (reason) {
    error.value = messageFor(reason);
  } finally {
    screenshotPending.value = false;
  }
}

function pointInCapture(event: PointerEvent): { x: number; y: number } {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(Math.round(event.clientX - bounds.left), Math.round(bounds.width))),
    y: Math.max(0, Math.min(Math.round(event.clientY - bounds.top), Math.round(bounds.height))),
  };
}

function startAreaSelection(event: PointerEvent): void {
  if (event.button !== 0) return;
  selectionStart.value = pointInCapture(event);
  selectionRect.value = null;
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function moveAreaSelection(event: PointerEvent): void {
  if (!selectionStart.value) return;
  const point = pointInCapture(event);
  selectionRect.value = {
    x: Math.min(selectionStart.value.x, point.x),
    y: Math.min(selectionStart.value.y, point.y),
    width: Math.abs(selectionStart.value.x - point.x),
    height: Math.abs(selectionStart.value.y - point.y),
  };
}

function finishAreaSelection(event: PointerEvent): void {
  if (!selectionStart.value) return;
  moveAreaSelection(event);
  const rect = selectionRect.value;
  cancelAreaSelection();
  if (rect && rect.width >= 5 && rect.height >= 5) {
    void copyScreenshot({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
}

function cancelAreaSelection(): void {
  capturingArea.value = false;
  selectionStart.value = null;
  selectionRect.value = null;
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (capturingArea.value) cancelAreaSelection();
  else menuOpen.value = false;
}

function closeMenuOnOutsideClick(event: PointerEvent): void {
  if (!menuOpen.value || !(event.target instanceof Node)) return;
  if (menuRoot.value?.contains(event.target) || menuTrigger.value?.contains(event.target)) return;
  menuOpen.value = false;
}

async function runNavigation(action: () => Promise<BrowserState>): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await action();
    browserReady = true;
    address.value = state.value.url;
  } catch (reason) {
    error.value = messageFor(reason);
  } finally {
    if (browserReady) await syncZoom();
    loading.value = false;
  }
}

async function toggleAnnotation(): Promise<void> {
  const enabled = !annotationMode.value;
  annotationMode.value = enabled;
  try {
    const api = requireBrowserApi();
    await api.browserSetAnnotationMode(props.agentId, props.browserId, enabled);
    if (!enabled) {
      annotations.value = [];
      await api.browserClearAnnotations(props.agentId, props.browserId);
    }
  } catch (reason) {
    annotationMode.value = false;
    error.value = messageFor(reason);
  }
}

async function syncBounds(): Promise<void> {
  if (!guestElement || !viewport.value || !browserReady || disposed || !props.visible) return;
  const rect = guestElement.getBoundingClientRect();
  const viewportRect = viewport.value.getBoundingClientRect();
  const x = Math.max(rect.left, viewportRect.left);
  const y = Math.max(rect.top, viewportRect.top);
  const bounds: BrowserViewportBounds = {
    x, y,
    width: Math.max(0, Math.min(rect.right, viewportRect.right) - x),
    height: Math.max(0, Math.min(rect.bottom, viewportRect.bottom) - y),
  };
  if (deviceToolbarVisible.value) bounds.contentOffset = { x: x - rect.left, y: y - rect.top };
  await appApi?.browserSetBounds(props.agentId, props.browserId, bounds);
}

function syncBoundsAfterWindowResize(): void {
  requestAnimationFrame(() => void syncBounds());
}

function handleEvent(event: MainToRendererEvent): void {
  if (
    event.type !== 'browser.annotationCreated' ||
    event.payload.agentId !== props.agentId ||
    event.payload.browserId !== props.browserId
  ) return;
  annotations.value = [...annotations.value, event.payload];
  annotationMode.value = true;
  void requireBrowserApi().browserSetAnnotationMode(props.agentId, props.browserId, true).catch((reason) => {
    annotationMode.value = false;
    error.value = messageFor(reason);
  });
}

async function sendAnnotations(): Promise<void> {
  if (annotations.value.length === 0) return;
  emit('send-prompt', annotationBatchPrompt(annotations.value));
  annotations.value = [];
  annotationMode.value = false;
  await requireBrowserApi().browserSetAnnotationMode(props.agentId, props.browserId, false);
  await requireBrowserApi().browserClearAnnotations(props.agentId, props.browserId);
}

function requireBrowserApi() {
  if (!appApi) throw new Error(translate('surface.browserPanel.browserIsUnavailable'));
  return appApi;
}

function annotationBatchPrompt(annotations: BrowserAnnotation[]): string {
  const entries = annotations.map((annotation, index) => {
    const target = annotation.kind === 'element'
      ? `element ${annotation.selector ?? annotation.label ?? 'selected on the page'}`
      : `selected area at ${Math.round(annotation.rect.x)},${Math.round(annotation.rect.y)} (${Math.round(annotation.rect.width)}×${Math.round(annotation.rect.height)})`;
    return `${index + 1}. Target: ${target}\n   Feedback: ${annotation.comment?.trim() || 'No comment provided.'}`;
  }).join('\n\n');
  return `Browser annotations on ${annotations[0]?.url}\n\n${entries}\n\nInspect the rendered page and make the smallest changes that address every annotation.`;
}

function messageFor(reason: unknown): string {
  return reason instanceof Error ? reason.message : translate('surface.browserPanel.couldNotLoadThisPage');
}
</script>

<style scoped>
.browser-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-shell-main);
}

.browser-panel__toolbar {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  height: 34px;
  min-height: 34px;
  max-height: 34px;
  box-sizing: border-box;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-outline-subtle);
  background: var(--color-shell-main);
}

.browser-panel__toolbar--visualization {
  grid-template-columns: minmax(0, 1fr) auto;
}

.browser-panel button {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
}

.browser-panel button:hover:not(:disabled),
.browser-panel button[aria-pressed="true"] {
  background: var(--color-surface-high);
  color: var(--color-text);
}

.browser-panel button:disabled {
  opacity: 0.38;
}

.browser-panel button :deep(svg) {
  width: 16px;
  height: 16px;
  stroke-width: 1.8;
}

.browser-panel__navigation {
  display: flex;
  gap: var(--space-3);
  justify-self: start;
}

.browser-panel__address,
.browser-panel__annotation-title,
.browser-panel__visualization-title {
  width: 100%;
  min-width: 0;
}

.browser-panel__visualization-title {
  overflow: hidden;
  padding: 0 var(--space-4);
  color: var(--color-text-muted);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-panel__address {
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  width: auto;
  height: 28px;
  margin: 0 var(--space-8);
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
}

.browser-panel__address input {
  box-sizing: border-box;
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
  text-align: center;
  outline: none;
  padding: 0 var(--space-3);
}

.browser-panel__address:hover,
.browser-panel__address:focus-within {
  border-color: var(--color-border);
  background: var(--color-surface-lowest);
}

.browser-panel .browser-panel__external-open {
  flex: 0 0 28px;
  width: 28px;
  height: 100%;
  border-radius: 0;
  opacity: 0;
  pointer-events: none;
}

.browser-panel__address:hover .browser-panel__external-open,
.browser-panel__address:focus-within .browser-panel__external-open {
  background: var(--color-surface-low);
  color: var(--color-text);
  opacity: 1;
  pointer-events: auto;
}

.browser-panel__annotation-title {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-13);
}

.browser-panel__annotation-title span:last-child {
  color: var(--color-text-muted);
}

.browser-panel__actions {
  position: relative;
  display: flex;
  gap: var(--space-3);
  justify-self: end;
}

.browser-panel__annotate[aria-pressed="true"] {
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
}

.browser-panel__menu {
  position: absolute;
  z-index: 3;
  top: calc(100% + var(--space-3));
  right: 0;
  min-width: 232px;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-menu);
}

.browser-panel__zoom {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--color-outline-subtle);
  color: var(--color-text);
  font-size: var(--font-size-14);
}

.browser-panel__zoom-icon {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  stroke-width: 2.5px;
}

.browser-panel__zoom > span {
  flex: 0 0 auto;
  font-weight: var(--font-weight-medium);
}

.browser-panel__zoom-actions {
  display: flex;
  align-items: center;
  margin-left: var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.browser-panel__zoom-actions span {
  min-width: 48px;
  border-right: 1px solid var(--color-outline-subtle);
  border-left: 1px solid var(--color-outline-subtle);
  text-align: center;
}

.browser-panel__zoom button {
  border-radius: var(--radius-sm);
}

.browser-panel__device-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 40px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-outline-subtle);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  white-space: nowrap;
  overflow-x: auto;
}

.browser-panel__device-toolbar label,
.browser-panel__dimensions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.browser-panel__device-toolbar select,
.browser-panel__device-toolbar input {
  box-sizing: border-box;
  height: 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
}

.browser-panel__device-toolbar select {
  padding: 0 var(--space-2);
}

.browser-panel__device-toolbar input {
  width: 64px;
  padding: 0 var(--space-2);
  text-align: center;
}

.browser-panel__device-toolbar button:last-child {
  margin-left: auto;
}

.browser-panel__device-zoom {
  color: var(--color-text-muted);
}

.browser-panel__surface {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.browser-panel__viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--color-shell-main);
  overflow: hidden;
}

.browser-panel__viewport--device {
  display: flex;
  align-items: flex-start;
  overflow: auto;
  background: var(--color-surface-low);
}

.browser-panel__guest-frame {
  position: relative;
  flex: none;
  width: 100%;
  height: 100%;
}

.browser-panel__viewport--device:not(.browser-panel__viewport--responsive) .browser-panel__guest-frame {
  box-sizing: content-box;
  margin: var(--space-4) auto;
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-menu);
}

.browser-panel__guest-frame :deep(.browser-panel__guest) {
  position: absolute;
  inset: 0;
  display: flex;
  width: 100%;
  height: 100%;
}

.browser-panel__capture-overlay {
  position: absolute;
  z-index: 2;
  inset: 0;
  cursor: crosshair;
  background: color-mix(in srgb, var(--color-shell-main) 35%, transparent);
  touch-action: none;
}

.browser-panel__capture-hint {
  position: absolute;
  top: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-text);
  color: var(--color-shell-main);
  font-size: var(--font-size-13);
  white-space: nowrap;
  pointer-events: none;
}

.browser-panel__capture-selection {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  pointer-events: none;
}

.browser-panel__error {
  margin: 0;
  padding: var(--space-4) var(--space-8);
  color: var(--color-error);
  background: var(--color-error-container);
}

@media (max-width: 760px) {
  .browser-panel__toolbar {
    grid-template-columns: 1fr auto;
  }
  .browser-panel__address,
  .browser-panel__annotation-title {
    display: none;
  }
}
</style>
