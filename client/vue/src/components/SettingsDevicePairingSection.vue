<template>
  <FormSection
    :title="$t('surface.settingsDevicePairingSection.codexDevicePairing')"
    title-id="settings-connections-device-pairing-title"
  >
    <div class="settings-device-pairing">
      <FormRow
        :title="$t('surface.settingsDevicePairingSection.allowConnections')"
        :description="description"
      >
        <template #control>
          <el-switch
            :model-value="remoteControlEnabled"
            :loading="action === 'enable' || action === 'disable'"
            :disabled="status === null || status.allowRemoteControl === false || action === 'start'"
            :aria-label="$t('surface.settingsDevicePairingSection.allowConnections')"
            @update:model-value="updateRemoteControlEnabled"
          />
        </template>
      </FormRow>

      <FormRow
        v-if="remoteControlEnabled"
        as="label"
        :title="$t('surface.settingsDevicePairingSection.keepThisMacAwake')"
        :description="$t('surface.settingsDevicePairingSection.preventSleepWhenThisMacIsPluggedInAndRemoteAccessIsEnabl')"
      >
        <template #control>
          <el-switch
            :model-value="settings.preventSleepWhenRemoteAccessEnabled"
            :aria-label="$t('surface.settingsDevicePairingSection.keepThisMacAwake')"
            @update:model-value="updateRemoteAccessKeepAwake"
          />
        </template>
      </FormRow>

      <p
        v-if="error"
        class="settings-device-pairing__error"
      >
        {{ error }}
      </p>
      <div
        v-else-if="loadingStatus"
        class="settings-device-pairing__loading"
      > {{ $t('surface.settingsDevicePairingSection.checkingDevicePairing') }} </div>

      <div
        v-if="session"
        class="settings-device-pairing__code"
      >
        <img
          v-if="qrDataUrl"
          :src="qrDataUrl"
          :alt="$t('surface.settingsDevicePairingSection.codexDevicePairingQRCode')"
        >
        <span>{{ $t('surface.settingsDevicePairingSection.scanWithTheCodexMobileAppOrEnterThisCode') }}</span>
        <strong>{{ session.manualPairingCode || session.pairingCode }}</strong>
        <em>{{ sessionStatus }}</em>
      </div>

      <template
        v-if="remoteControlEnabled"
      >
        <FormRow
          :title="$t('surface.settingsDevicePairingSection.pairedDevices')"
          :description="pairedDevicesDescription"
        >
          <template #control>
            <span class="settings-device-pairing__actions">
              <el-button
                v-if="status?.status === 'connecting'"
                text
                size="small"
                loading
                disabled
              > {{ $t('surface.settingsDevicePairingSection.refreshing') }} </el-button>
              <template v-else-if="status?.status === 'connected'">
                <el-button
                  text
                  size="small"
                  :loading="action === 'start'"
                  @click="startPairing"
                > {{ $t('surface.settingsDevicePairingSection.addDevice') }} </el-button>
                <el-button
                  text
                  size="small"
                  :loading="loadingDevices"
                  @click="loadDevices"
                > {{ $t('surface.settingsDevicePairingSection.refresh') }} </el-button>
              </template>
            </span>
          </template>
        </FormRow>
        <div
          v-if="devices.length > 0"
          class="settings-device-pairing__device-list"
        >
          <hr
            class="settings-device-pairing__device-divider"
            aria-hidden="true"
          >
          <FormRow
            v-for="device in devices"
            :key="device.clientId"
            :title="device.displayName || device.deviceModel || $t('surface.settingsDevicePairingSection.codexDevice')"
            :description="deviceLabel(device)"
          >
            <template #control>
              <el-button
                text
                type="danger"
                size="small"
                :loading="revokingDeviceId === device.clientId"
                @click="confirmRevoke(device)"
              > {{ $t('surface.settingsDevicePairingSection.revoke') }} </el-button>
            </template>
          </FormRow>
        </div>
      </template>
    </div>
  </FormSection>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { ElMessageBox } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { toString as qrCodeToString } from 'qrcode';
import type { DevicePairingSession, DevicePairingStatus, PairedDevice, UpdateSettingsInput } from '@workspace/core/contracts';
import { codexPairingUrl } from '../device-pairing';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';

const props = withDefaults(defineProps<{
  getStatus?: () => Promise<DevicePairingStatus>;
  enable?: () => Promise<DevicePairingStatus>;
  disable?: () => Promise<DevicePairingStatus>;
  start?: () => Promise<DevicePairingSession>;
  check?: (session: DevicePairingSession) => Promise<boolean>;
  listDevices?: (environmentId: string) => Promise<PairedDevice[]>;
  revokeDevice?: (environmentId: string, clientId: string) => Promise<void>;
  settings?: { preventSleepWhenRemoteAccessEnabled: boolean };
  updateSettings?: (input: UpdateSettingsInput) => Promise<void>;
}>(), {
  getStatus: async () => ({ status: 'disabled' as const }),
  enable: async () => ({ status: 'disabled' as const }),
  disable: async () => ({ status: 'disabled' as const }),
  start: async () => ({ pairingCode: '', environmentId: '', expiresAt: '' }),
  check: async () => false,
  listDevices: async () => [],
  revokeDevice: async () => undefined,
  settings: () => ({ preventSleepWhenRemoteAccessEnabled: true }),
  updateSettings: async () => undefined,
});

const status = ref<DevicePairingStatus | null>(null);
const session = ref<DevicePairingSession | null>(null);
const devices = ref<PairedDevice[]>([]);
const loadingStatus = ref(false);
const loadingDevices = ref(false);
const error = ref<string | null>(null);
const action = ref<'enable' | 'disable' | 'start' | null>(null);
const revokingDeviceId = ref<string | null>(null);
const qrDataUrl = ref<string | null>(null);
let pairingPollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let statusPollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const description = computed(() => {
  if (status.value?.allowRemoteControl === false) return translate('surface.settingsDevicePairingSection.disabledByYourCodexConfiguration');
  if (status.value?.status === 'connected') return translate('surface.settingsDevicePairingSection.remoteControlIsOnPairAndManageDevicesThatCanAccessThisCl');
  if (status.value?.status === 'connecting') return translate('surface.settingsDevicePairingSection.connectingToTheCodexRemoteControlService');
  if (status.value?.status === 'errored') return translate('surface.settingsDevicePairingSection.codexRemoteControlNeedsAttention');
  return translate('surface.settingsDevicePairingSection.connectTheOfficialCodexMobileAppToThisAppInstance');
});
const remoteControlEnabled = computed(() => (
  status.value !== null && status.value.status !== 'disabled'
));
const pairedDevicesDescription = computed(() => {
  if (status.value?.status === 'connecting') return translate('surface.settingsDevicePairingSection.connectingBeforeDevicesCanBePaired');
  if (status.value?.status === 'errored') return translate('surface.settingsDevicePairingSection.remoteControlNeedsAttention');
  if (!loadingDevices.value && devices.value.length === 0) return translate('surface.settingsDevicePairingSection.noPairedDevices');
  return '';
});

const sessionStatus = computed(() => {
  if (!session.value) return '';
  return new Date(session.value.expiresAt).getTime() <= Date.now()
    ? translate('surface.settingsDevicePairingSection.codeExpired')
    : `Expires ${new Date(session.value.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
});

onMounted(() => void loadStatus());
onBeforeUnmount(() => {
  stopPairingPoll();
  stopStatusPoll();
});

async function loadStatus(): Promise<void> {
  loadingStatus.value = true;
  error.value = null;
  try {
    status.value = await props.getStatus();
    if (status.value.status === 'connected') await loadDevices();
    if (status.value.status === 'connecting') scheduleStatusPoll();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loadingStatus.value = false;
  }
}

async function enablePairing(): Promise<void> {
  action.value = 'enable';
  error.value = null;
  try {
    status.value = await props.enable();
    if (status.value.status === 'connected') await loadDevices();
    if (status.value.status === 'connecting') scheduleStatusPoll();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    action.value = null;
  }
}

async function disablePairing(): Promise<void> {
  action.value = 'disable';
  error.value = null;
  try {
    status.value = await props.disable();
    session.value = null;
    qrDataUrl.value = null;
    devices.value = [];
    stopPairingPoll();
    stopStatusPoll();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    action.value = null;
  }
}

function updateRemoteControlEnabled(value: boolean | string | number): void {
  void (value === true ? enablePairing() : disablePairing());
}

function updateRemoteAccessKeepAwake(value: boolean | string | number): void {
  void props.updateSettings({
    general: {
      preventSleepWhenRemoteAccessEnabled: value === true,
    },
  });
}

async function startPairing(): Promise<void> {
  action.value = 'start';
  error.value = null;
  stopPairingPoll();
  try {
    session.value = await props.start();
    qrDataUrl.value = await pairingCodeDataUrl(session.value.pairingCode);
    schedulePairingPoll();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    action.value = null;
  }
}

function schedulePairingPoll(): void {
  stopPairingPoll();
  pairingPollTimer = globalThis.setTimeout(() => void pollPairing(), 2_000);
}

async function pollPairing(): Promise<void> {
  pairingPollTimer = null;
  const activeSession = session.value;
  if (!activeSession || new Date(activeSession.expiresAt).getTime() <= Date.now()) return;
  try {
    if (await props.check(activeSession)) {
      await loadDevices();
      session.value = null;
      qrDataUrl.value = null;
      return;
    }
  } catch (cause) {
    error.value = errorMessage(cause);
    return;
  }
  schedulePairingPoll();
}

function stopPairingPoll(): void {
  if (pairingPollTimer !== null) globalThis.clearTimeout(pairingPollTimer);
  pairingPollTimer = null;
}

function scheduleStatusPoll(): void {
  stopStatusPoll();
  statusPollTimer = globalThis.setTimeout(() => {
    statusPollTimer = null;
    void loadStatus();
  }, 2_000);
}

function stopStatusPoll(): void {
  if (statusPollTimer !== null) globalThis.clearTimeout(statusPollTimer);
  statusPollTimer = null;
}

async function loadDevices(): Promise<void> {
  const environmentId = status.value?.environmentId ?? session.value?.environmentId;
  if (!environmentId) return;
  loadingDevices.value = true;
  try {
    devices.value = await props.listDevices(environmentId);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loadingDevices.value = false;
  }
}

async function confirmRevoke(device: PairedDevice): Promise<void> {
  const environmentId = status.value?.environmentId ?? session.value?.environmentId;
  if (!environmentId) return;
  try {
    await ElMessageBox.confirm(
      translate('dynamic.misc.deviceRevokeDetail', {
        device: device.displayName || device.deviceModel || translate('dynamic.misc.deviceFallback'),
      }),
      translate('surface.settingsDevicePairingSection.revokePairedDevice'),
      { cancelButtonText: translate('common.cancel'), confirmButtonText: translate('common.revoke'), type: 'warning' },
    );
  } catch {
    return;
  }
  revokingDeviceId.value = device.clientId;
  try {
    await props.revokeDevice(environmentId, device.clientId);
    devices.value = devices.value.filter((candidate) => candidate.clientId !== device.clientId);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    revokingDeviceId.value = null;
  }
}

function deviceLabel(device: PairedDevice): string {
  return [device.platform, device.deviceType, device.appVersion ? `Codex ${device.appVersion}` : null]
    .filter(Boolean)
    .join(' · ') || translate('dynamic.misc.pairedCodexClient');
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function pairingCodeDataUrl(pairingCode: string): Promise<string> {
  const svg = await qrCodeToString(codexPairingUrl(pairingCode), {
    type: 'svg', margin: 1, width: 180,
    color: { dark: '#111111', light: '#ffffff' },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
</script>

<style scoped>
.settings-device-pairing {
  display: flex;
  flex-direction: column;
}

.settings-device-pairing__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
}

.settings-device-pairing__device-divider {
  margin: 0 var(--space-12);
  border: 0;
  border-top: 1px solid var(--color-border);
}

.settings-device-pairing__code {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-20);
  background: var(--color-surface-low);
}

.settings-device-pairing__code span,
.settings-device-pairing__code em {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.settings-device-pairing__code em {
  font-style: normal;
}

.settings-device-pairing__code strong {
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-24);
  letter-spacing: 0.12em;
}

.settings-device-pairing__code img {
  width: 180px;
  height: 180px;
  border-radius: var(--radius-sm);
}

.settings-device-pairing__loading {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  padding: var(--space-8);
}

.settings-device-pairing__error {
  color: var(--color-error);
  font-size: var(--font-size-13);
  margin: 0;
}
</style>
