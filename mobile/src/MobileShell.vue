<template>
  <main class="mobile-shell">
    <header class="mobile-shell__header">
      <strong>{{ product.name }}</strong>
      <span>{{ t('mobile.companion') }}</span>
    </header>
    <div class="mobile-shell__connection" role="status" aria-live="polite">
      {{ t(`mobile.connection.${state.status.value}`) }}
      <button v-if="state.status.value === 'connected'" class="app-button app-button--tertiary" @click="state.disconnect">{{ t('mobile.disconnect') }}</button>
      <button v-if="['disconnected', 'error'].includes(state.status.value)" class="app-button app-button--secondary" @click="state.reconnect">{{ t('mobile.reconnect') }}</button>
      <button v-if="hasPairing" class="app-button app-button--tertiary" @click="state.revoke">{{ t('mobile.forget') }}</button>
    </div>
    <section v-if="!hasPairing" class="mobile-shell__welcome">
      <h1>{{ t('mobile.title') }}</h1>
      <p>{{ t('mobile.pairingHint') }}</p>
      <template v-if="laptops.length">
      <label for="laptop">{{ t('mobile.laptop') }}</label>
      <select id="laptop" v-model="selectedLaptop">
        <option v-for="laptop in laptops" :key="laptop.id" :value="laptop.id">{{ laptop.name }}</option>
      </select>
      <button class="app-button app-button--primary" :disabled="!selectedLaptop || busy" @click="state.connect(selectedLaptop)">{{ t('mobile.openLaptop') }}</button>
      </template>
      <template v-if="connector.pair">
        <button class="app-button app-button--secondary" :disabled="pairing" @click="scan">{{ t('mobile.scan') }}</button>
        <details><summary>{{ t('mobile.pasteInvitation') }}</summary>
          <textarea v-model="invitationText" autocomplete="off" spellcheck="false" :aria-label="t('mobile.invitation')" />
        </details>
        <label>{{ t('mobile.deviceName') }}<input v-model="deviceName" maxlength="80" autocomplete="off"></label>
        <template v-if="invitationText">
          <p>{{ t('mobile.relay') }}: {{ invitationPreview.relayOrigin }}</p>
          <code>{{ invitationPreview.hostId }}</code>
          <label><input v-model="trustRelay" type="checkbox"> {{ t('mobile.trustRelay') }}</label>
          <button class="app-button app-button--primary" :disabled="pairing || !trustRelay || !deviceName.trim()" @click="pair">{{ t('mobile.requestPairing') }}</button>
        </template>
        <div v-if="pendingIdentity" role="status"><p>{{ t('mobile.approveOnLaptop') }}</p><code>{{ pendingIdentity }}</code></div>
        <p v-if="pairError" role="alert">{{ t('mobile.errors.pairing') }}</p>
      </template>
    </section>
    <nav v-else class="mobile-shell__selection" :aria-label="t('mobile.navigation')">
      <label>{{ t('mobile.team') }}
        <select :value="state.teamId.value" :disabled="busy" @change="state.selectTeam(valueOf($event))">
          <option value="">{{ t('mobile.chooseTeam') }}</option>
          <option v-for="team in state.workspace.value.teams" :key="team.id" :value="team.id">{{ team.name }}</option>
        </select>
      </label>
      <label>{{ t('mobile.agent') }}
        <select :value="state.agentId.value" :disabled="busy || !state.teamId.value" @change="state.selectAgent(valueOf($event))">
          <option value="">{{ t('mobile.chooseAgent') }}</option>
          <option v-for="agent in state.agents.value" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
      </label>
    </nav>
    <p v-if="state.error.value" class="mobile-shell__notice" role="alert">{{ t(state.error.value) }}</p>
    <p v-if="hostUnavailable" class="mobile-shell__notice" role="alert">{{ t('mobile.hostUnavailable') }}</p>
    <p v-if="state.deliveryUnknown.value" class="mobile-shell__notice" role="status">{{ t('mobile.deliveryUnknown') }}</p>
    <p v-if="state.readOnly.value" class="mobile-shell__notice" role="status">{{ t('mobile.readOnly') }}</p>
    <template v-if="state.agent.value">
      <div class="mobile-shell__agent-status" role="status">{{ agentStatusText(state.agent.value, t) }}</div>
      <ConversationPane
        :controller="controller"
        :agent="state.agent.value"
        :agents="state.agents.value"
        :keyboard-active="false"
        :plan-visible="false"
        :history-loading="state.loading.value"
        :has-visible-messages="Boolean(state.conversation.value?.payload.snapshot.messages.length)"
        :empty-subhead="t('mobile.keyboardHint')"
      />
    </template>
    <p v-else-if="hasPairing" class="mobile-shell__empty">{{ t('mobile.chooseConversation') }}</p>
    <footer class="mobile-shell__footer">{{ t('mobile.keyboardHint') }}</footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createCodexConversationPaneController, type CodexConversationPaneState } from '@codex-app-sdk/vue';
import { product } from '@workspace/core/product';
import ConversationPane from '@workspace/vue/components/ConversationPane.vue';
import { backendChoicesKey } from '@workspace/vue/components/backend-selection';
import { agentStatusText } from '@workspace/vue/shared/agent-display';
import { createCompanionState } from './companion-state';
import type { CompanionConnector } from './companion-port';
import type { MobileHost } from './mobile-host';
import type { DraftStore } from './protected-storage';

const props = defineProps<{ connector: CompanionConnector; host: MobileHost; draftStore?: DraftStore }>();
const { t } = useI18n();
const state = createCompanionState(props.connector, props.draftStore);
provide(backendChoicesKey, computed(() => [...new Set(state.workspace.value.agents.map((a) => a.backend))]));
const laptops = ref(props.connector.laptops);
const selectedLaptop = ref(laptops.value[0]?.id ?? '');
const invitationText = ref(''); const deviceName = ref('My phone'); const trustRelay = ref(false);
watch(invitationText, () => { trustRelay.value = false; });
const pairing = ref(false); const pendingIdentity = ref(''); const pairError = ref(false);
const invitationPreview = computed(() => { try { const payload = JSON.parse(invitationText.value); return { relayOrigin: String(payload.relayOrigin ?? ''), hostId: String(payload.hostId ?? '') }; } catch { return { relayOrigin: '', hostId: '' }; } });
async function scan() { try { invitationText.value = await props.host.scanInvitation?.() ?? ''; trustRelay.value = false; } catch { pairError.value = true; } }
async function pair() {
  if (!props.connector.pair || pairing.value || !trustRelay.value) return;
  pairing.value = true; pairError.value = false;
  try {
    const id = await props.connector.pair(invitationText.value, deviceName.value, (identity) => { pendingIdentity.value = identity; });
    if (disposed) return;
    invitationText.value = ''; pendingIdentity.value = ''; laptops.value = props.connector.laptops; selectedLaptop.value = id;
    await state.connect(id);
  } catch { if (!disposed) pairError.value = true; }
  finally { pairing.value = false; }
}

const hasPairing = computed(() => !['unpaired', 'revoked'].includes(state.status.value) && state.workspace.value.teams.length > 0);
const busy = computed(() => ['connecting', 'reconnecting'].includes(state.status.value));
const controller = createCodexConversationPaneController({
  state: computed<CodexConversationPaneState>(() => {
    const snapshot = state.conversation.value?.payload.snapshot;
    return {
      identity: {
        conversationKey: JSON.stringify([state.laptopId.value, state.agentId.value]),
        messages: snapshot?.messages ?? [], turns: snapshot?.turns,
        activeTurnId: snapshot?.activeTurnId, busy: snapshot?.busy ?? false,
        disabled: !state.canSend.value,
      },
      history: { loading: state.loading.value },
      composer: { state: state.draft.value, placeholder: t('mobile.prompt') },
      capabilities: { models: false, skills: false, reasoningEffort: false, serviceTier: false,
        planMode: false, goals: false, steerPrompt: false, interrupt: false, history: false,
        deleteTurn: false, editTurn: false, retryTurn: false, approvals: false, approvalPresets: [] },
      policy: { attachEnabled: false, canDeleteTurn: false, canEditTurn: false, canForkTurn: false,
        canRetryTurn: false, actionsDisabled: true, followUpsDisabled: true },
    };
  }),
  actions: { updateComposerState: state.updateDraft, submit: state.submit },
});
let disposed = false;
const hostUnavailable = ref(false);
let removeResume = () => {};
let activity = Promise.resolve();
const lifecycle = props.host.onActivity
  ? props.host.onActivity((isActive) => {
    activity = activity.then(async () => { if (disposed) return; if (isActive) { await props.connector.resume?.(); await state.reconnect(); } else { state.disconnect(); await props.connector.suspend?.(); } }).catch(() => { hostUnavailable.value = true; });
  })
  : props.host.onResume(() => void state.reconnect());
void lifecycle.then((remove) => {
  if (disposed) remove();
  else removeResume = remove;
}).catch(() => { if (!disposed) hostUnavailable.value = true; });
onMounted(async () => {
  try { await props.connector.initialize?.(); if (!disposed) { laptops.value = props.connector.laptops; selectedLaptop.value = laptops.value[0]?.id ?? ''; } }
  catch { if (!disposed) hostUnavailable.value = true; }
});
onBeforeUnmount(() => { disposed = true; removeResume(); state.dispose(); void props.connector.dispose?.(); invitationText.value = ''; });
function valueOf(event: Event): string { return (event.target as HTMLSelectElement).value; }
</script>

<style scoped>
.mobile-shell {
  /* The SDK's public token avoids iOS zoom when its native keyboard focuses the editor. */
  --codex-composer-font-size: 16px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  max-width: 900px;
  margin-inline: auto;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  color: var(--color-text);
  background: var(--color-shell-main);
  overflow: hidden;
}

.mobile-shell__header,
.mobile-shell__connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border);
}

.mobile-shell__header { justify-content: space-between; }
.mobile-shell__header span { color: var(--color-text-muted); }
.mobile-shell__connection { font-size: var(--font-size-12); }
.mobile-shell__connection button { min-height: 44px; }
.mobile-shell__welcome { display: grid; gap: var(--space-4); padding: var(--space-6); overflow: auto; }
.mobile-shell__welcome h1 { font-size: var(--font-size-24); margin: 0; }
.mobile-shell__welcome p { margin: 0; }
.mobile-shell__selection { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.mobile-shell__selection label { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--font-size-12); }
.mobile-shell select,
.mobile-shell__welcome input:not([type="checkbox"]),
.mobile-shell__welcome textarea { width: 100%; min-width: 0; min-height: 44px; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text); background: var(--color-surface-low); font-size: 16px; }
.mobile-shell__welcome code { overflow-wrap: anywhere; }
.mobile-shell__welcome textarea { min-height: 100px; }
.mobile-shell__notice { padding: var(--space-2) var(--space-4); margin: 0; color: var(--color-text); background: var(--color-surface-high); }
.mobile-shell__agent-status { padding: 0 var(--space-4) var(--space-2); font-size: var(--font-size-12); color: var(--color-text-muted); }
.mobile-shell__empty { flex: 1; padding: var(--space-4); }
.mobile-shell__footer { flex: 0 0 auto; padding: var(--space-2) var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-12); }

@media (max-height: 500px) {
  .mobile-shell__header,
  .mobile-shell__footer { display: none; }
}
</style>
