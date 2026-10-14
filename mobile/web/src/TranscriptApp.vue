<template>
  <div class="transcript" :style="{ '--transcript-top': `${insets.top}px`, '--transcript-bottom': `${insets.bottom}px` }">
    <button v-if="history.failed" class="app-button app-button--tertiary" @click="loadOlder">Couldn’t load earlier messages. Retry</button>
    <ConversationPane
      v-if="agent && (frame || ready)"
      :controller="controller"
      :agent="agent"
      :agents="agents"
      :keyboard-active="false"
      :plan-visible="false"
      :history-loading="false"
      :has-visible-messages="messages.length > 0"
      empty-subhead=""
    >
      <template v-if="engines" #empty-actions>
        <div class="engine-picker" role="radiogroup" aria-label="Engine">
          <button v-for="choice in engines.choices" :key="choice" type="button" role="radio" class="engine-picker__option"
            :class="{ 'engine-picker__option--selected': choice === engines.current }" :aria-checked="choice === engines.current"
            @click="chooseEngine(choice)">{{ engineName(choice) }}</button>
        </div>
      </template>
    </ConversationPane>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, provide, reactive, shallowRef } from 'vue';
import { createCodexConversationPaneController, type CodexConversationPaneState } from '@codex-app-sdk/vue';
import type { Agent } from '@workspace/core/contracts';
import ConversationPane from '@workspace/vue/components/ConversationPane.vue';
import { backendChoicesKey } from '@workspace/vue/components/backend-selection';
import type { CompanionConversation, CompanionHistoryState } from '../../src/companion-port';
import { handler } from './native';

const frame = shallowRef<CompanionConversation | null>(null);
const agent = shallowRef<Agent | null>(null);
const agents = shallowRef<Agent[]>([]);
const ready = shallowRef(false);
const engines = shallowRef<{ current: string; choices: string[] } | null>(null);
const insets = reactive({ top: 0, bottom: 0 });
const history = shallowRef<CompanionHistoryState>({ hasOlder: false, loadingOlder: false, failed: false });
provide(backendChoicesKey, computed(() => [...new Set(agents.value.map((candidate) => candidate.backend))]));

const messages = computed(() => frame.value?.payload.snapshot.messages ?? []);

/** Read-only: the native app owns the composer and every interaction; this page only renders the conversation. */
const controller = createCodexConversationPaneController({
  state: computed<CodexConversationPaneState>(() => {
    const snapshot = frame.value?.payload.snapshot;
    return {
      identity: { conversationKey: agent.value?.id ?? null, messages: snapshot?.messages ?? [], turns: snapshot?.turns, activeTurnId: snapshot?.activeTurnId, busy: snapshot?.busy ?? false, disabled: true },
      history: { loading: false, hasOlder: history.value.hasOlder && !history.value.failed, loadingOlder: history.value.loadingOlder },
      thread: { approvals: [], clientRequests: [], answeredClientRequestIds: new Set<string>(), queuedPrompts: snapshot && 'queuedPrompts' in snapshot ? snapshot.queuedPrompts : [], contextUsage: snapshot && 'contextUsage' in snapshot ? snapshot.contextUsage : null },
      composer: { state: { text: '', selectionStart: 0, selectionEnd: 0 } },
      capabilities: { models: false, skills: false, reasoningEffort: false, serviceTier: false, planMode: false, goals: false, steerPrompt: false, interrupt: false, history: true,
        deleteTurn: false, editTurn: false, retryTurn: false, approvals: false, approvalPresets: [] },
      policy: { attachEnabled: false, canDeleteTurn: false, canEditTurn: false, canForkTurn: false, canRetryTurn: false, actionsDisabled: true, followUpsDisabled: true },
    };
  }),
  actions: { loadOlderHistory: loadOlder },
});

const engineNames: Record<string, string> = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' };
const engineName = (id: string) => engineNames[id] ?? id;
function chooseEngine(backend: string) {
  if (backend !== engines.value?.current) void handler('transcript').postMessage(JSON.stringify({ type: 'backend', backend }));
}

function loadOlder() {
  if (!agent.value || history.value.loadingOlder || !history.value.hasOlder) return;
  history.value = { ...history.value, loadingOlder: true, failed: false };
  void handler('transcript').postMessage(JSON.stringify({ type: 'loadOlder', agentId: agent.value.id }));
}

let presentation = 0;
window.companionTranscript = {
  async setConversation(json) {
    const revision = ++presentation;
    const message = JSON.parse(json) as { frame: CompanionConversation | null; ready?: boolean; agent: Agent | null; agents: Agent[]; history?: CompanionHistoryState; engines?: { current: string; choices: string[] } | null };
    frame.value = message.frame; agent.value = message.agent; agents.value = message.agents;
    ready.value = message.ready ?? false;
    engines.value = message.engines ?? null;
    history.value = message.history ?? { hasOlder: false, loadingOlder: false, failed: false };
    if ((!message.frame && !message.ready) || !message.agent) return null;
    await nextTick();
    // Let the updated pane paint before the native shell removes its loading overlay.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return revision === presentation ? message.agent.id : null;
  },
  setInsets(top, bottom) { insets.top = top; insets.bottom = bottom; },
};
</script>

<style>
html, body, #app { height: 100%; margin: 0; background: transparent; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
.transcript { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; box-sizing: border-box; padding: var(--transcript-top) 0 var(--transcript-bottom); }
/* Keep secondary transcript text legible at a phone's viewing distance. */
.transcript, .transcript :where(.codex-chat-theme) {
  --font-size-12: 14px;
  --font-size-13: 15px;
  --font-size-13-5: 15.5px;
  --font-size-14: 16px;
  --font-size-15: 17px;
  --line-height-20: 24px;
}
.transcript .codex-workbench-layout__footer { display: none; }
/* Native insets already reserve the composer; the hidden web footer has no height. */
.transcript .codex-conversation-pane__messages { --codex-scroll-to-bottom-offset: var(--space-12); }
/* The shared empty state frames its actions as a card; the engine control stands on its own. */
.transcript .conversation-pane__empty-actions { width: auto; padding: 0; border: 0; background: none; box-shadow: none; }
/* A segmented control under the empty chat's title: the selected engine is raised, the others recede. */
.engine-picker { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--color-surface-base); }
.engine-picker__option { appearance: none; border: 0; background: transparent; color: var(--color-text-muted); font: inherit; font-size: 15px; font-weight: 500; padding: 8px 16px; border-radius: 999px; transition: background 0.15s, color 0.15s; -webkit-tap-highlight-color: transparent; }
.engine-picker__option--selected { background: var(--color-surface-lowest); color: var(--color-text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14); }
</style>
