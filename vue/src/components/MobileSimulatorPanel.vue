<template>
  <section class="mobile-simulator" :aria-label="$t('surface.mobileSimulator.title')">
    <header class="mobile-simulator__toolbar">
      <div v-if="attachment" class="mobile-simulator__picker">
        <button
          ref="pickerTrigger"
          type="button"
          class="mobile-simulator__picker-trigger"
          :aria-label="$t('surface.mobileSimulator.device')"
          :aria-expanded="pickerOpen"
          aria-haspopup="menu"
          :disabled="busy"
          @click="pickerOpen = !pickerOpen"
        >
          <span class="mobile-simulator__dot mobile-simulator__dot--booted" aria-hidden="true" />
          <span class="mobile-simulator__name">{{ attachment.device.name }}</span>
          <IconChevronDown aria-hidden="true" />
        </button>
        <div
          v-if="pickerOpen"
          ref="pickerMenu"
          class="mobile-simulator__menu"
          role="menu"
          :aria-label="$t('surface.mobileSimulator.device')"
        >
          <template v-for="group in deviceGroups(catalog.devices)" :key="group.id">
            <div class="mobile-simulator__menu-heading" role="presentation">{{ group.label }}</div>
            <button
              v-for="device in group.devices"
              :key="device.id"
              type="button"
              role="menuitemradio"
              class="mobile-simulator__menu-item"
              :aria-checked="device.id === attachment.device.id"
              :disabled="!usable(device)"
              @click="switchTo(device)"
            >
              <span
                class="mobile-simulator__dot"
                :class="{ 'mobile-simulator__dot--booted': device.state === 'booted' }"
                aria-hidden="true"
              />
              <span class="mobile-simulator__menu-label">{{ device.name }}</span>
              <span v-if="!usable(device)" class="mobile-simulator__menu-note">{{ $t('surface.mobileSimulator.inUse') }}</span>
              <span v-else-if="device.platform !== 'ios'" class="mobile-simulator__menu-note">{{ platformLabel(device.platform) }}</span>
              <IconCheck v-if="device.id === attachment.device.id" class="mobile-simulator__menu-check" aria-hidden="true" />
            </button>
          </template>
        </div>
      </div>
      <template v-else>
        <span class="mobile-simulator__title">{{ $t('surface.mobileSimulator.tab') }}</span>
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.refresh')"
          :title="$t('surface.mobileSimulator.refresh')"
          :disabled="busy"
          @click="refreshDevices"
        >
          <IconRefresh aria-hidden="true" />
        </button>
      </template>
    </header>
    <p v-if="error" class="mobile-simulator__error" role="alert">
      {{ error }} <button type="button" @click="retry">{{ $t('surface.mobileSimulator.retry') }}</button>
    </p>
    <p v-if="typingError && !error" class="mobile-simulator__error" role="alert">{{ typingError }}</p>
    <div v-if="!attachment" class="mobile-simulator__empty">
      <div class="mobile-simulator__empty-icon" aria-hidden="true">
        <IconDeviceMobile />
      </div>
      <h3>{{ $t('surface.mobileSimulator.emptyTitle') }}</h3>
      <p v-if="!loaded" class="mobile-simulator__loading" role="status">
        <span class="app-spinner app-spinner--sm" aria-hidden="true" />{{ $t('surface.mobileSimulator.loading') }}
      </p>
      <template v-else>
        <el-segmented
          v-if="platforms.length > 1"
          class="mobile-simulator__segments"
          :model-value="activePlatform"
          :options="platforms.map((item) => ({ value: item, label: platformLabel(item) }))"
          :aria-label="$t('surface.mobileSimulator.platform')"
          @update:model-value="platform = $event"
        />
        <div v-for="group in deviceGroups(platformDevices)" :key="group.id" class="mobile-simulator__group">
          <div class="mobile-simulator__group-heading">{{ group.label }}</div>
          <button
            v-for="device in group.devices"
            :key="device.id"
            type="button"
            class="mobile-simulator__device"
            :disabled="busy || !usable(device)"
            @click="attach(device)"
          >
            <span
              class="mobile-simulator__dot"
              :class="{ 'mobile-simulator__dot--booted': device.state === 'booted' }"
              aria-hidden="true"
            />
            <span class="mobile-simulator__device-name">{{ device.name }}</span>
            <span class="mobile-simulator__device-action">
              <template v-if="!usable(device)">{{ $t('surface.mobileSimulator.inUse') }}</template>
              <template v-else-if="pending === device.id"><span class="app-spinner app-spinner--sm" aria-hidden="true" />{{ $t(device.state === 'booted' ? 'surface.mobileSimulator.attaching' : 'surface.mobileSimulator.booting') }}</template>
              <template v-else>{{ $t(device.state === 'booted' ? 'surface.mobileSimulator.attach' : 'surface.mobileSimulator.boot') }}</template>
            </span>
          </button>
        </div>
        <p v-if="!platformDevices.length && !platformSetup.length" class="mobile-simulator__none">
          {{ $t('surface.mobileSimulator.empty') }}
        </p>
        <div v-for="item in platformSetup" :key="item.platform" class="mobile-simulator__setup">
          <span>{{ item.message }}</span>
          <button type="button" @click="openSetup(item.url)">{{ $t('surface.mobileSimulator.setup') }}</button>
        </div>
      </template>
    </div>
    <div v-else-if="poweringOff" class="mobile-simulator__screen mobile-simulator__screen--status" role="status">
      <span class="app-spinner app-spinner--sm" aria-hidden="true" />{{ $t('surface.mobileSimulator.poweringOff') }}
    </div>
    <div v-else class="mobile-simulator__screen">
      <MobileLiveScreen
        v-if="!error"
        :agent-id="agentId"
        :attachment-id="attachment.id"
        :platform="attachment.device.platform"
        :disabled="busy"
        @keydown="keyDown"
        @button="button"
      />
    </div>
    <footer v-if="attachment && !poweringOff" class="mobile-simulator__dock">
      <div class="mobile-simulator__pill" role="toolbar" :aria-label="$t('surface.mobileSimulator.controls')">
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.home')"
          :title="$t('surface.mobileSimulator.home')"
          :disabled="busy"
          @click="button('home')"
        >
          <IconHome aria-hidden="true" />
        </button>
        <button
          v-if="attachment.device.platform === 'android'"
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.back')"
          :title="$t('surface.mobileSimulator.back')"
          :disabled="busy"
          @click="button('back')"
        >
          <IconArrowLeft aria-hidden="true" />
        </button>
        <span class="mobile-simulator__divider" aria-hidden="true" />
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.rotate')"
          :title="$t('surface.mobileSimulator.rotate')"
          :disabled="busy"
          @click="rotate"
        >
          <IconRotate2 aria-hidden="true" />
        </button>
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.screenshot')"
          :title="$t('surface.mobileSimulator.screenshot')"
          :disabled="busy"
          @click="copyScreenshot"
        >
          <IconCamera aria-hidden="true" />
        </button>
        <span class="mobile-simulator__divider" aria-hidden="true" />
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.powerOff')"
          :title="$t('surface.mobileSimulator.powerOff')"
          :disabled="busy"
          @click="powerOff"
        >
          <IconPower aria-hidden="true" />
        </button>
        <button
          type="button"
          class="mobile-simulator__icon-button"
          :aria-label="$t('surface.mobileSimulator.detach')"
          :title="$t('surface.mobileSimulator.detach')"
          :disabled="busy"
          @click="detach"
        >
          <IconLogout aria-hidden="true" />
        </button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  IconArrowLeft,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconDeviceMobile,
  IconHome,
  IconLogout,
  IconPower,
  IconRefresh,
  IconRotate2,
} from '@tabler/icons-vue';
import type {
  MobileAction,
  MobileAttachment,
  MobileCatalog,
  MobileDevice,
  MobileRequest,
  MobileResult,
} from '@workspace/core/mobile-simulator';
import { ElMessage } from 'element-plus';
import { translate } from '../i18n';
import { appApi, appPlatformActions } from '../platform-api';
import MobileLiveScreen from './MobileLiveScreen.vue';
const props = defineProps<{ agentId: string; visible: boolean }>();
const attachment = ref<MobileAttachment | null>(null);
const catalog = ref<MobileCatalog>({ devices: [], setup: [] });
const platform = ref<MobileDevice['platform'] | ''>('');
const pending = ref('');
const poweringOff = ref(false);
const loaded = ref(false);
const pickerOpen = ref(false);
const pickerTrigger = ref<HTMLElement>();
const pickerMenu = ref<HTMLElement>();
const error = ref('');
/** A rejected keystroke is reported without ending the live view. */
const typingError = ref('');
const busy = ref(false);
const TYPING_BATCH_MS = 30;
let generation = 0;
let operation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Electron prefixes rejected IPC calls with transport noise the user shouldn't read. */
function errorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
function execute(input: MobileRequest): Promise<MobileResult> {
  if (!appApi?.mobileSimulator) return Promise.reject(new Error('Mobile simulators require the desktop app.'));
  return appApi.mobileSimulator(props.agentId, input);
}
function apply(result: MobileResult) {
  attachment.value = result.attachment;
  if (result.catalog) catalog.value = result.catalog;
}
async function run(input: MobileRequest): Promise<MobileResult | undefined> {
  const identity = generation;
  operation++;
  busy.value = true;
  error.value = '';
  try {
    const result = await execute(input);
    if (identity !== generation) return undefined;
    apply(result);
    return result;
  } catch (cause) {
    if (identity === generation) {
      error.value = errorMessage(cause);
    }
    return undefined;
  } finally {
    if (identity === generation) busy.value = false;
  }
}
async function refreshDevices() {
  await run({ action: 'list' });
  loaded.value = true;
}
async function attach(device: MobileDevice) {
  pending.value = device.id;
  try {
    await run({ action: 'attach', deviceId: device.id });
    // The listing may be stale (e.g. the device changed state meanwhile): show reality next to the error.
    if (error.value && !attachment.value) {
      const failure = error.value;
      await refreshDevices();
      error.value = failure;
    }
  } finally {
    pending.value = '';
  }
}
async function detach() {
  if (attachment.value) await run({ action: 'detach', attachmentId: attachment.value.id });
}
async function rotate() {
  if (attachment.value && !busy.value) await run({ action: 'rotate', attachmentId: attachment.value.id });
}
async function powerOff() {
  if (!attachment.value || busy.value) return;
  // The host ends the video stream before the device finishes shutting down; stop showing it now.
  poweringOff.value = true;
  try {
    await run({ action: 'shutdown', attachmentId: attachment.value.id });
    if (!attachment.value && !error.value) await refreshDevices();
  } finally {
    poweringOff.value = false;
  }
}
async function copyScreenshot() {
  if (!attachment.value || busy.value) return;
  const result = await run({ action: 'screenshot', attachmentId: attachment.value.id });
  if (!result?.frame) return;
  try {
    const bytes = Uint8Array.from(atob(result.frame.data), (character) => character.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    ElMessage.success(translate('surface.mobileSimulator.screenshotCopied'));
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}
async function switchTo(device: MobileDevice) {
  pickerOpen.value = false;
  if (!attachment.value || device.id === attachment.value.device.id) return;
  await detach();
  if (!attachment.value) await attach(device);
}
async function action(input: MobileAction) {
  if (attachment.value && !busy.value) await run({ ...input, attachmentId: attachment.value.id });
}
function button(button: Extract<MobileAction, { action: 'button' }>['button']) {
  void action({ action: 'button', button });
}
function openSetup(url: string) {
  void appPlatformActions.openExternal?.(url);
}
function usable(device: MobileDevice) {
  return !device.owner || device.owner === props.agentId;
}
function platformLabel(value: MobileDevice['platform']) {
  return translate(value === 'ios' ? 'surface.mobileSimulator.ios' : 'surface.mobileSimulator.android');
}
function deviceGroups(devices: MobileDevice[]) {
  return [
    { id: 'booted', label: translate('surface.mobileSimulator.booted'), devices: devices.filter((d) => d.state === 'booted') },
    { id: 'available', label: translate('surface.mobileSimulator.available'), devices: devices.filter((d) => d.state !== 'booted') },
  ].filter((group) => group.devices.length);
}
const platforms = computed(() => {
  const present = new Set([...catalog.value.devices.map((d) => d.platform), ...catalog.value.setup.map((i) => i.platform)]);
  return (['ios', 'android'] as const).filter((item) => present.has(item));
});
const activePlatform = computed(
  () =>
    platforms.value.find((item) => item === platform.value) ??
    catalog.value.devices.find((d) => d.state === 'booted' && usable(d))?.platform ??
    platforms.value[0],
);
const platformDevices = computed(() => catalog.value.devices.filter((d) => d.platform === activePlatform.value));
const platformSetup = computed(() => catalog.value.setup.filter((item) => item.platform === activePlatform.value));
function refreshOnFocus() {
  if (props.visible && !attachment.value && loaded.value && !busy.value) void refreshDevices();
}
function closePickerOnOutsideClick(event: PointerEvent) {
  if (!pickerOpen.value || !(event.target instanceof Node)) return;
  if (pickerMenu.value?.contains(event.target) || pickerTrigger.value?.contains(event.target)) return;
  pickerOpen.value = false;
}
function retry() {
  error.value = '';
  void refreshDevices();
}

/** Keys typed on the focused screen go straight to the device, in order and without blocking the pane. */
let typed = '';
let typedTimer: ReturnType<typeof setTimeout> | undefined;
let typing: Promise<unknown> = Promise.resolve();
function sendKey(input: MobileAction) {
  const current = attachment.value;
  if (!current) return;
  typing = typing.then(() =>
    execute({ ...input, attachmentId: current.id }).then(
      () => {
        typingError.value = '';
      },
      (cause) => {
        typingError.value = errorMessage(cause);
      },
    ),
  );
}
function flushTyped() {
  clearTimeout(typedTimer);
  if (!typed) return;
  const value = typed;
  typed = '';
  sendKey({ action: 'text', text: value });
}
function keyDown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'Enter' || event.key === 'Backspace') {
    event.preventDefault();
    flushTyped();
    sendKey({ action: 'button', button: event.key === 'Enter' ? 'enter' : 'backspace' });
  } else if (/^[\x20-\x7e]$/.test(event.key)) {
    event.preventDefault();
    typed += event.key;
    clearTimeout(typedTimer);
    typedTimer = setTimeout(flushTyped, TYPING_BATCH_MS);
  }
}
async function poll(identity: number) {
  if (identity !== generation || !props.visible) return;
  const currentOperation = operation;
  if (!busy.value && !error.value) {
    try {
      const result = await execute({ action: 'status' });
      if (identity !== generation) return;
      if (currentOperation !== operation) {
        timer = setTimeout(() => void poll(identity), 700);
        return;
      }
      const before = attachment.value;
      apply(result);
      // The device was closed outside the app: its listing is stale, so show what is really available.
      if (before && !result.attachment) void refreshDevices();
    } catch (cause) {
      if (identity === generation) {
        error.value = errorMessage(cause);
        }
    }
  }
  if (identity === generation) timer = setTimeout(() => void poll(identity), 700);
}
watch(
  () => [props.agentId, props.visible] as const,
  async () => {
    const identity = ++generation;
    clearTimeout(timer);
    typed = '';
    typingError.value = '';
    clearTimeout(typedTimer);
    platform.value = '';
    pending.value = '';
    poweringOff.value = false;
    loaded.value = false;
    pickerOpen.value = false;
    catalog.value = { devices: [], setup: [] };
    attachment.value = null;
    busy.value = false;
    error.value = '';
    if (!props.visible) return;
    await refreshDevices();
    if (identity === generation) void poll(identity);
  },
  { immediate: true },
);
onMounted(() => {
  document.addEventListener('pointerdown', closePickerOnOutsideClick);
  window.addEventListener('focus', refreshOnFocus);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closePickerOnOutsideClick);
  window.removeEventListener('focus', refreshOnFocus);
  clearTimeout(typedTimer);
  generation++;
  clearTimeout(timer);
});
</script>

<style scoped>
.mobile-simulator {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  background: var(--color-shell-main);
  color: var(--color-text);
  font-size: var(--font-size-13);
  user-select: none;
}
.mobile-simulator button {
  font: inherit;
}
.mobile-simulator__toolbar {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  height: 34px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-outline-subtle);
}
.mobile-simulator__title {
  padding: 0 var(--space-2);
  color: var(--color-text-muted);
  font-weight: var(--font-weight-medium);
}
.mobile-simulator__picker {
  position: relative;
  min-width: 0;
}
.mobile-simulator__picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  height: 26px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
}
.mobile-simulator__picker-trigger svg {
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
}
.mobile-simulator__picker-trigger:hover:not(:disabled),
.mobile-simulator__picker-trigger[aria-expanded='true'] {
  background: var(--color-surface-high);
}
.mobile-simulator__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mobile-simulator__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--color-outline);
}
.mobile-simulator__dot--booted {
  background: var(--color-success);
}
.mobile-simulator__menu {
  position: absolute;
  z-index: 3;
  top: calc(100% + var(--space-2));
  left: 0;
  min-width: 232px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-menu-background);
  box-shadow: var(--shadow-menu);
}
.mobile-simulator__menu-heading,
.mobile-simulator__group-heading {
  padding: var(--space-3) var(--space-4) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
}
.mobile-simulator__menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  text-align: left;
}
.mobile-simulator__menu-item:hover:not(:disabled) {
  background: var(--color-surface-high);
}
.mobile-simulator__menu-item:disabled {
  opacity: 0.45;
}
.mobile-simulator__menu-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mobile-simulator__menu-note {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.mobile-simulator__menu-check {
  flex: none;
  width: 14px;
  height: 14px;
}
.mobile-simulator__icon-button {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
}
.mobile-simulator__icon-button svg {
  width: 17px;
  height: 17px;
  stroke-width: 1.7;
}
.mobile-simulator__icon-button:hover:not(:disabled) {
  background: var(--color-surface-high);
  color: var(--color-text);
}
.mobile-simulator__icon-button:disabled,
.mobile-simulator__device:disabled {
  opacity: 0.4;
}
.mobile-simulator__error {
  display: flex;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-6);
  background: var(--color-error-container);
  color: var(--color-error);
}
.mobile-simulator__error button,
.mobile-simulator__setup button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-decoration: underline;
}
.mobile-simulator__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  padding: var(--space-10) var(--space-6);
  overflow-y: auto;
  text-align: center;
}
.mobile-simulator__empty-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--space-6);
  border-radius: var(--radius-full);
  background: var(--color-surface-high);
  color: var(--color-text-muted);
}
.mobile-simulator__empty-icon svg {
  width: 22px;
  height: 22px;
  stroke-width: 1.6;
}
.mobile-simulator__empty h3 {
  margin: 0 0 var(--space-8);
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-semibold);
}
.mobile-simulator__empty p {
  max-width: 280px;
  margin: 0 0 var(--space-6);
  color: var(--color-text-muted);
  line-height: 1.45;
}
.mobile-simulator__loading,
.mobile-simulator__device-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.mobile-simulator__loading svg,
.mobile-simulator__device-action svg {
  width: 14px;
  height: 14px;
}
.mobile-simulator__segments {
  margin-bottom: var(--space-8);
}
.mobile-simulator__group {
  width: 100%;
  max-width: 340px;
  text-align: left;
}
.mobile-simulator__device {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-4) var(--space-4);
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text);
  text-align: left;
}
.mobile-simulator__device:hover:not(:disabled) {
  background: var(--color-surface-high);
}
.mobile-simulator__device-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mobile-simulator__device-action {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
.mobile-simulator__device:hover:not(:disabled) .mobile-simulator__device-action {
  color: var(--color-text);
}
.mobile-simulator__none {
  margin-bottom: 0;
}
.mobile-simulator__setup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  margin-top: var(--space-6);
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--color-outline-subtle);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  text-align: left;
}
.mobile-simulator__setup button {
  flex: none;
  color: var(--color-text);
}
.mobile-simulator__screen {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
}
.mobile-simulator__screen--status {
  gap: var(--space-3);
  color: var(--color-text-muted);
}
.mobile-simulator__screen--status svg {
  width: 14px;
  height: 14px;
}
.mobile-simulator__screen img {
  outline: none;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
  object-fit: contain;
  touch-action: none;
  user-select: none;
}
.mobile-simulator__dock {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6) var(--space-6);
}
.mobile-simulator__pill {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-md);
}
.mobile-simulator__divider {
  width: 1px;
  height: 16px;
  margin: 0 var(--space-2);
  background: var(--color-outline-subtle);
}
</style>
