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
          :title="$t('surface.settingsMobileSection.pairTitle')"
          :description="status.enabled && !status.connected ? $t('surface.settingsMobileSection.relayReconnecting') : ''"
        >
          <template #control>
            <button v-if="status.enabled" class="app-button app-button--tertiary" type="button" :disabled="busy" @click="disable">{{ $t('surface.settingsMobileSection.turnOff') }}</button>
            <button class="app-button app-button--primary" type="button" :disabled="busy" @click="pair">{{ $t('surface.settingsMobileSection.pairPhone') }}</button>
          </template>
        </FormRow>
        <FormRow v-if="invitation && invitation.expiresAt > now" as="div" :title="$t('surface.settingsMobileSection.pairingCode')" :description="$t('surface.settingsMobileSection.pairingCodeHint')">
          <template #copy>
            <code class="settings-mobile__code" data-testid="pairing-code">{{ invitation.code }}</code>
            <img v-if="qr" class="settings-mobile__qr" :src="qr" :alt="$t('surface.settingsMobileSection.invitationAlt')" width="200" height="200">
          </template>
        </FormRow>
        <FormRow v-for="request in status.pending" :key="request.id" class="settings-mobile__request" :title="request.name">
          <template #control>
            <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="decide(request.id, false)">{{ $t('surface.settingsMobileSection.deny') }}</button>
            <button class="app-button app-button--primary" type="button" :disabled="busy" @click="decide(request.id, true)">{{ $t('surface.settingsMobileSection.approve') }}</button>
          </template>
        </FormRow>
        <FormRow v-for="device in status.devices" :key="device.peerId" :title="device.name">
          <template #control>
            <button class="app-button app-button--tertiary" type="button" :disabled="busy" @click="act({ action: 'revoke', peerId: device.peerId })">{{ $t('surface.settingsMobileSection.revoke') }}</button>
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
    qr.value = await QRCode.toDataURL(result.invitation.code, { width: 200, margin: 2 });
    now.value = Date.now();
  }
}
async function disable() { invitation.value = null; qr.value = ''; await act({ action: 'disable' }); }
async function decide(pendingId: string, approve: boolean) {
  await act({ action: 'decide', pendingId, approve });
  invitation.value = null; qr.value = '';
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 2000); });
onBeforeUnmount(() => { disposed = true; clearInterval(timer); invitation.value = null; qr.value = ''; });
</script>
<style scoped>
.settings-mobile__code { margin-block: var(--space-4); color: var(--color-text); font-family: var(--font-family-mono); font-size: var(--font-size-28); font-weight: var(--font-weight-semibold); letter-spacing: 0.12em; user-select: all; }
.settings-mobile__qr { align-self: flex-start; border-radius: var(--radius-lg); background: var(--color-surface-lowest); }
</style>
