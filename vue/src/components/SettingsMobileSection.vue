<template>
  <FormSection title="Mobile access" title-id="settings-mobile-title">
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="status">
      <p>Laptop identity</p><code class="settings-mobile__identity">{{ status.hostId }}</code>
      <p role="status">{{ status.enabled ? (status.connected ? 'Relay connected' : 'Relay unavailable · reconnecting') : 'Mobile access is off' }}</p>
      <template v-if="!status.enabled">
        <label class="settings-mobile__field">Relay URL
          <input v-model="relayOrigin" placeholder="wss://your-relay.example" autocomplete="off" spellcheck="false">
        </label>
        <label class="settings-mobile__field">Relay identity
          <input v-model="relayPeerId" autocomplete="off" spellcheck="false">
        </label>
        <label><input v-model="trustRelay" type="checkbox"> I trust this relay service with connection metadata.</label>
        <p>The relay operator can see device identities, addresses and traffic sizes. Conversations remain encrypted between your devices.</p>
        <button class="app-button app-button--primary" :disabled="busy || !trustRelay || !relayOrigin || !relayPeerId" @click="act({ action: 'enable', relayOrigin, relayPeerId })">Enable mobile access</button>
      </template>
      <template v-else>
        <button class="app-button app-button--secondary" :disabled="busy || !status.connected" @click="pair">Pair phone</button>
        <button class="app-button app-button--tertiary" :disabled="busy" @click="disable">Disable mobile access</button>
      </template>
      <div v-if="invitation && invitation.expiresAt > now" class="settings-mobile__invitation">
        <img v-if="qr" :src="qr" alt="Phone pairing invitation" width="280" height="280">
        <p>Scan this code in the companion app. Confirm the device below before it can access any team.</p>
        <details><summary>Copy invitation for this device</summary><textarea :value="JSON.stringify(invitation)" readonly aria-label="Pairing invitation" /></details>
      </div>
      <article v-for="request in status.pending" :key="request.id" class="settings-mobile__device">
        <strong>{{ request.name }}</strong>
        <code>{{ request.peerId }}</code>
        <p>Check that this identity matches the phone.</p>
        <label v-for="team in teams" :key="team.id"><input v-model="scopeFor(request.id).teamIds" type="checkbox" :value="team.id"> {{ team.name }}</label>
        <label><input v-model="scopeFor(request.id).canSend" type="checkbox"> Allow sending prompts</label>
        <button class="app-button app-button--primary" :disabled="busy || !scopeFor(request.id).teamIds.length" @click="decide(request.id, true)">Approve device</button>
        <button class="app-button app-button--tertiary" :disabled="busy" @click="decide(request.id, false)">Deny</button>
      </article>
      <article v-for="device in status.devices" :key="device.peerId" class="settings-mobile__device">
        <strong>{{ device.name }}</strong><code>{{ device.peerId }}</code>
        <span>{{ device.canSend ? 'Read and send' : 'Read only' }} · {{ device.teamIds.map(id => teams.find(team => team.id === id)?.name ?? id).join(', ') }}</span>
        <button class="app-button app-button--tertiary" :disabled="busy" @click="act({ action: 'revoke', peerId: device.peerId })">Revoke</button>
      </article>
    </template>
  </FormSection>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import QRCode from 'qrcode';
import type { Team } from '@workspace/core/contracts';
import type { CompanionControl, CompanionControlResult, CompanionInvitation, CompanionStatus } from '@workspace/core/companion-protocol';
import FormSection from '../shared/form/FormSection.vue';
const props = defineProps<{ control(input: CompanionControl): Promise<CompanionControlResult>; teams: Team[] }>();
const status = ref<CompanionStatus | null>(null);
const invitation = ref<CompanionInvitation | null>(null);
const qr = ref(''); const now = ref(Date.now()); const error = ref(''); const busy = ref(false);
const relayOrigin = ref(''); const relayPeerId = ref(''); const trustRelay = ref(false);
const scopes = reactive<Record<string, { teamIds: string[]; canSend: boolean }>>({});
function scopeFor(id: string) { return scopes[id] ??= { teamIds: [], canSend: false }; }
watch([relayOrigin, relayPeerId], () => { trustRelay.value = false; });
let disposed = false; let polling = false; let timer: ReturnType<typeof setInterval>;
async function refresh() {
  if (polling || busy.value || disposed) return;
  polling = true;
  try { const result = await props.control({ action: 'status' }); if (!disposed) { status.value = result.status; now.value = Date.now(); } }
  catch { if (!disposed) error.value = 'Mobile access is unavailable. Check the laptop daemon and relay configuration.'; }
  finally { polling = false; }
}
async function act(input: CompanionControl) {
  busy.value = true; error.value = '';
  try { const result = await props.control(input); if (!disposed) status.value = result.status; return result; }
  catch { if (!disposed) error.value = 'Could not complete this mobile access operation.'; }
  finally { busy.value = false; }
}
async function pair() {
  invitation.value = null; qr.value = '';
  const result = await act({ action: 'invite' });
  if (!disposed && result?.invitation) {
    invitation.value = result.invitation;
    qr.value = await QRCode.toDataURL(JSON.stringify(result.invitation), { width: 280, margin: 2 });
    now.value = Date.now();
  }
}
async function disable() { invitation.value = null; qr.value = ''; await act({ action: 'disable' }); }
async function decide(pendingId: string, approve: boolean) {
  await act({ action: 'decide', pendingId, approve, ...scopeFor(pendingId) });
  invitation.value = null; qr.value = ''; delete scopes[pendingId];
}
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 2000); });
onBeforeUnmount(() => { disposed = true; clearInterval(timer); invitation.value = null; qr.value = ''; });
</script>
<style scoped>
.settings-mobile__field { display: grid; gap: var(--space-2); margin-block: var(--space-3); }
.settings-mobile__field input,
.settings-mobile__invitation textarea { padding: var(--space-2); color: var(--color-text); background: var(--color-surface-low); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.settings-mobile__device { display: grid; gap: var(--space-2); padding-block: var(--space-4); border-top: 1px solid var(--color-border); }
.settings-mobile__identity,
.settings-mobile__device code { overflow-wrap: anywhere; }
.settings-mobile__invitation { display: grid; justify-items: start; padding-block: var(--space-4); }
.settings-mobile__invitation textarea { width: 100%; min-height: 100px; }
</style>
