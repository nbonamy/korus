<template>
  <main class="mobile-shell" @touchstart.passive="onEdgeTouchStart" @touchend.passive="onEdgeTouchEnd">
    <MobilePairing
      v-if="!showWorkspace"
      :connector="connector"
      :host="host"
      :laptops="laptops"
      :status="state.status.value"
      :error="state.error.value"
      @open="state.connect"
      @paired="onPaired"
      @forget="forget"
    />
    <template v-else>
      <header class="mobile-shell__header">
        <button class="mobile-shell__menu" type="button" :aria-label="t('mobile.agents')" :aria-expanded="drawerOpen" @click="drawerOpen = true">
          <MenuIcon aria-hidden="true" />
        </button>
        <div v-if="current" class="mobile-shell__identity">
          <AgentAvatar v-if="current.group.icon" :avatar="current.group.icon" :name="current.group.label" size="md" />
          <div class="mobile-shell__title">
            <strong>{{ current.session.displayTitle }}</strong>
            <span role="status">
              <i class="mobile-shell__dot" :data-status="current.session.status.type" aria-hidden="true" />
              {{ subtitle }}
            </span>
          </div>
        </div>
        <strong v-else class="mobile-shell__product">{{ product.name }}</strong>
      </header>
      <div v-if="connectionNotice" class="mobile-shell__banner" role="status" aria-live="polite">
        <span>{{ t(`mobile.connection.${state.status.value}`) }}</span>
        <button v-if="canReconnect" class="app-button app-button--secondary" type="button" @click="state.reconnect">{{ t('mobile.reconnect') }}</button>
      </div>
      <p v-if="state.error.value" class="mobile-shell__banner mobile-shell__banner--error" role="alert">{{ t(state.error.value) }}</p>
      <p v-if="state.deliveryUnknown.value" class="mobile-shell__banner" role="status">{{ t('mobile.deliveryUnknown') }}</p>
      <ConversationPane
        v-if="state.agent.value"
        class="mobile-shell__conversation"
        :controller="controller"
        :agent="state.agent.value"
        :agents="state.agents.value"
        :keyboard-active="false"
        :plan-visible="false"
        :history-loading="state.loading.value"
        :has-visible-messages="Boolean(state.conversation.value?.payload.snapshot.messages.length)"
      />
      <button v-else class="mobile-shell__empty" type="button" @click="drawerOpen = true">
        <ProductMarkIcon aria-hidden="true" />
        <span>{{ t('mobile.agents') }}</span>
      </button>
      <MobileDrawer
        :open="drawerOpen"
        :teams="state.workspace.value.teams"
        :agents="state.agents.value"
        :repository-icons="state.workspace.value.repositoryIcons"
        :team-id="state.teamId.value"
        :agent-id="state.agentId.value"
        :status="state.status.value"
        @close="drawerOpen = false"
        @select-team="selectTeam"
        @select-agent="selectAgent"
        @disconnect="state.disconnect"
        @reconnect="state.reconnect"
        @forget="forget"
      />
    </template>
    <p v-if="hostUnavailable" class="mobile-shell__banner mobile-shell__banner--error" role="alert">{{ t('mobile.hostUnavailable') }}</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createCodexConversationPaneController, type CodexConversationPaneState } from '@codex-app-sdk/vue';
import { product } from '@workspace/core/product';
import AgentAvatar from '@workspace/vue/components/AgentAvatar.vue';
import ConversationPane from '@workspace/vue/components/ConversationPane.vue';
import { backendChoicesKey } from '@workspace/vue/components/backend-selection';
import { agentStatusText } from '@workspace/vue/shared/agent-display';
import { MenuIcon, ProductMarkIcon } from '@workspace/vue/shared/icons/app-icons';
import { createCompanionState } from './companion-state';
import type { CompanionConnector } from './companion-port';
import type { MobileHost } from './mobile-host';
import MobileDrawer from './MobileDrawer.vue';
import MobilePairing from './MobilePairing.vue';
import { activeSession, projectMobileGroups } from './workspace-groups';
import type { DraftStore } from './protected-storage';

const props = defineProps<{ connector: CompanionConnector; host: MobileHost; draftStore?: DraftStore }>();
const { t } = useI18n();
const state = createCompanionState(props.connector, props.draftStore);
provide(backendChoicesKey, computed(() => [...new Set(state.workspace.value.agents.map((a) => a.backend))]));
const laptops = ref(props.connector.laptops);
const drawerOpen = ref(false);
const hostUnavailable = ref(false);

const showWorkspace = computed(() => !['unpaired', 'revoked'].includes(state.status.value) && state.workspace.value.teams.length > 0);
const connectionNotice = computed(() => state.status.value !== 'connected');
const canReconnect = computed(() => ['disconnected', 'error'].includes(state.status.value));
const current = computed(() => activeSession(projectMobileGroups(
  state.agents.value, state.agentId.value || null, t('mobile.chats'), state.workspace.value.repositoryIcons)));
const subtitle = computed(() => {
  if (!current.value || !state.agent.value) return '';
  const status = agentStatusText(state.agent.value, t);
  return current.value.group.kind === 'repository' ? `${current.value.group.label} · ${status}` : status;
});

async function onPaired(id: string) {
  laptops.value = props.connector.laptops;
  await state.connect(id);
}
async function forget() {
  drawerOpen.value = false;
  await state.revoke();
  laptops.value = props.connector.laptops;
}
async function selectTeam(id: string) {
  await state.selectTeam(id);
  const team = state.workspace.value.teams.find((candidate) => candidate.id === id);
  const first = state.agents.value.find((agent) => agent.id === team?.activeAgentId) ?? state.agents.value[0];
  if (first && !state.agentId.value) await state.selectAgent(first.id);
}
async function selectAgent(id: string) {
  drawerOpen.value = false;
  await state.selectAgent(id);
}
// Land in a conversation, not an empty picker: first team, its active (or first) agent.
watch([state.status, state.workspace], async () => {
  if (state.status.value !== 'connected' || state.teamId.value) return;
  const team = state.workspace.value.teams.find((candidate) => state.workspace.value.agents.some((agent) => agent.teamId === candidate.id));
  if (team) await selectTeam(team.id);
  else drawerOpen.value = true;
});

let edgeStart: { x: number; y: number } | null = null;
function onEdgeTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  edgeStart = touch && touch.clientX < 24 ? { x: touch.clientX, y: touch.clientY } : null;
}
function onEdgeTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (showWorkspace.value && edgeStart && touch && touch.clientX - edgeStart.x > 60 && Math.abs(touch.clientY - edgeStart.y) < 40) drawerOpen.value = true;
  edgeStart = null;
}

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
  try {
    await props.connector.initialize?.();
    if (disposed) return;
    laptops.value = props.connector.laptops;
    // A saved pairing is the way in: open it rather than asking again. With several, the person chooses.
    if (laptops.value.length === 1 && state.status.value === 'unpaired') await state.connect(laptops.value[0]!.id);
  }
  catch { if (!disposed) hostUnavailable.value = true; }
});
onBeforeUnmount(() => { disposed = true; removeResume(); state.dispose(); void props.connector.dispose?.(); });
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

.mobile-shell__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  min-height: 56px;
  padding: 0 var(--space-8) 0 var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.mobile-shell__menu {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text);
  background: transparent;
}

.mobile-shell__menu svg { width: var(--icon-xl); height: var(--icon-xl); }

.mobile-shell__identity {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-width: 0;
}

.mobile-shell__title {
  display: grid;
  min-width: 0;
  line-height: var(--line-height-20);
}

.mobile-shell__title strong,
.mobile-shell__title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-shell__title strong { font-size: var(--font-size-16); font-weight: var(--font-weight-semibold); }
.mobile-shell__title span { display: flex; align-items: center; gap: var(--space-3); color: var(--color-text-muted); font-size: var(--font-size-13); }
.mobile-shell__product { font-size: var(--font-size-18); font-weight: var(--font-weight-bold); }

.mobile-shell__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-success);
}

.mobile-shell__dot[data-status="idle"] { background: var(--color-outline); }
.mobile-shell__dot[data-status="working"],
.mobile-shell__dot[data-status="awaitingInput"] { background: var(--color-warning); }
.mobile-shell__dot[data-status="error"] { background: var(--color-error); }

.mobile-shell__banner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  margin: 0;
  padding: var(--space-4) var(--space-8);
  color: var(--color-on-warning-container);
  background: var(--color-warning-container);
  font-size: var(--font-size-14);
}

.mobile-shell__banner .app-button { min-height: 36px; }
.mobile-shell__banner--error { color: var(--color-on-error-container); background: var(--color-error-container); }

.mobile-shell__conversation { flex: 1; min-height: 0; }

.mobile-shell__empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: var(--space-6);
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  font-size: var(--font-size-15);
}

.mobile-shell__empty svg { width: 44px; height: 40px; color: var(--color-primary); }
</style>
