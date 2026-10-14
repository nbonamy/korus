<template>
  <FormSection :title="$t('surface.settingsMobileSection.title')" title-id="settings-mobile-title">
    <FormRow v-if="error" :title="$t('surface.settingsMobileSection.unavailable')" :description="error" />
    <template v-else-if="status">
      <FormRow
        v-if="!status.configured"
        :title="$t('surface.settingsMobileSection.relayNotConfigured')"
        :description="status.error ?? $t('surface.settingsMobileSection.relayNotConfiguredHint')"
      />
      <template v-else>
        <FormRow
          :title="$t('surface.settingsMobileSection.allowConnections')"
          :description="status.enabled && !status.connected ? $t('surface.settingsMobileSection.relayReconnecting') : $t('surface.settingsMobileSection.allowConnectionsHint')"
        >
          <template #control>
            <el-switch
              :model-value="status.enabled"
              :loading="busy"
              :disabled="busy"
              :aria-label="$t('surface.settingsMobileSection.allowConnections')"
              @update:model-value="toggle"
            />
          </template>
        </FormRow>
        <FormRow v-if="status.enabled" :title="$t('surface.settingsMobileSection.pairedDevices')" :description="status.devices.length ? '' : $t('surface.settingsMobileSection.noDevices')">
          <template #control>
            <el-button text size="small" :disabled="busy || !status.connected" @click="pair">{{ $t('surface.settingsMobileSection.addDevice') }}</el-button>
          </template>
        </FormRow>
        <FormRow v-if="status.enabled && invitation && invitation.expiresAt > now" as="div" class="settings-mobile__pairing" role="group" :aria-label="$t('surface.settingsMobileSection.pairingCode')" :title="$t('surface.settingsMobileSection.pairingCode')" :description="$t('surface.settingsMobileSection.pairingCodeHint')">
          <template #copy>
            <code class="settings-mobile__code" data-testid="pairing-code">{{ invitation.code }}</code>
          </template>
          <template #control>
            <img v-if="qr" class="settings-mobile__qr" :src="qr" :alt="$t('surface.settingsMobileSection.invitationAlt')" width="128" height="128">
          </template>
        </FormRow>
        <FormRow v-for="request in status.enabled ? status.pending : []" :key="request.id" class="settings-mobile__request" :title="request.name">
          <template #control>
            <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="decide(request.id, false)">{{ $t('surface.settingsMobileSection.deny') }}</button>
            <button class="app-button app-button--primary" type="button" :disabled="busy" @click="decide(request.id, true)">{{ $t('surface.settingsMobileSection.approve') }}</button>
          </template>
        </FormRow>
        <FormRow v-for="device in status.enabled ? status.devices : []" :key="device.peerId" :title="device.name">
          <template #control>
            <el-button text type="danger" size="small" :disabled="busy" @click="act({ action: 'revoke', peerId: device.peerId })">{{ $t('surface.settingsMobileSection.revoke') }}</el-button>
          </template>
        </FormRow>
      </template>
    </template>
  </FormSection>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import QRCode from 'qrcode';
import type { CompanionControl, CompanionControlResult, CompanionInvitation, CompanionStatus } from '@workspace/core/companion-protocol';
import { translate } from '../i18n';
import FormRow from '../shared/form/FormRow.vue';
import FormSection from '../shared/form/FormSection.vue';
const props = defineProps<{ control(input: CompanionControl): Promise<CompanionControlResult> }>();
const status = ref<CompanionStatus | null>(null);
const invitation = ref<CompanionInvitation | null>(null);
const qr = ref(''); const now = ref(Date.now()); const error = ref(''); const busy = ref(false);
let disposed = false; let polling = false; let timer: ReturnType<typeof setInterval>;
async function refresh() {
  if (polling || busy.value || disposed) return;
  polling = true;
  try { const result = await props.control({ action: 'status' }); if (!disposed) { status.value = result.status; error.value = ''; now.value = Date.now(); } }
  catch { if (!disposed) error.value = translate('surface.settingsMobileSection.daemonHint'); }
  finally { polling = false; }
}
async function act(input: CompanionControl) {
  busy.value = true; error.value = '';
  try { const result = await props.control(input); if (!disposed) status.value = result.status; return result; }
  catch (cause) { if (!disposed) error.value = cause instanceof Error && cause.message ? cause.message : translate('surface.settingsMobileSection.operationFailed'); }
  finally { busy.value = false; }
}
async function pair() {
  invitation.value = null; qr.value = '';
  const result = await act({ action: 'invite' });
  if (!disposed && result?.invitation) {
    invitation.value = result.invitation;
    qr.value = await QRCode.toDataURL(result.invitation.code, { width: 256, margin: 4 });
    now.value = Date.now();
  }
}
async function toggle(value: boolean | string | number) {
  const result = await act({ action: value === true ? 'resume' : 'disable' });
  if (result && !result.status.enabled) { invitation.value = null; qr.value = ''; }
}
async function decide(pendingId: string, approve: boolean) {
  await act({ action: 'decide', pendingId, approve });
  invitation.value = null; qr.value = '';
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 2000); });
onBeforeUnmount(() => { disposed = true; clearInterval(timer); invitation.value = null; qr.value = ''; });
</script>
<style scoped>
.settings-mobile__pairing {
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: var(--space-10);
  padding: var(--space-4) var(--space-8);
}

.settings-mobile__pairing :deep(.form-row__copy) {
  grid-column: 2;
  grid-row: 1;
  gap: var(--space-2);
}

.settings-mobile__pairing :deep(.form-row__control) {
  grid-column: 1;
  grid-row: 1;
  justify-self: start;
}

.settings-mobile__code {
  margin-top: var(--space-2);
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-20);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
  letter-spacing: 0.08em;
  white-space: nowrap;
  user-select: all;
}

.settings-mobile__qr {
  display: block;
  width: 128px;
  height: 128px;
  border-radius: var(--radius-md);
}

@media (max-width: 420px) {
  .settings-mobile__pairing {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
  }

  .settings-mobile__pairing :deep(.form-row__copy) {
    grid-column: 1;
    grid-row: 2;
  }
}
</style>
