<template>
  <div class="transcript-layout" :class="{ 'transcript-layout--preview': files.state.value }" :style="{ '--transcript-top': `${insets.top}px`, '--transcript-bottom': `${insets.bottom}px`, '--transcript-leading': `${insets.leading}px`, '--transcript-trailing': `${insets.trailing}px` }">
  <div class="transcript">
    <button v-if="history.failed" class="app-button app-button--tertiary transcript__history-retry" @click="loadOlder">Couldn’t load earlier messages. Retry</button>
    <div v-if="imageLoading" class="transcript__media-status" role="status">Loading image…</div>
    <ConversationPane
      v-if="agent && (frame || ready)"
      :controller="controller"
      :agent="agent"
      :agents="agents"
      :keyboard-active="false"
      :plan-visible="false"
      :history-loading="false"
      :has-visible-messages="messages.length > 0"
      :read-conversation-content="readConversationContent"
      :empty-headline="repository ? `Chat in ${repository.repositoryName}` : undefined"
      :empty-subhead="repository?.branch ?? ''"
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
  <FilePreviewPane v-if="files.state.value" :state="files.state.value" @close="files.close" @refresh="files.refresh" @mode="files.mode" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, provide, reactive, shallowRef } from 'vue';
import { createCodexConversationPaneController, provideCodexHostCapabilities, type CodexConversationPaneState } from '@codex-app-sdk/vue';
import type { Agent } from '@workspace/core/contracts';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import ConversationPane from '@workspace/vue/components/ConversationPane.vue';
import { backendChoicesKey } from '@workspace/vue/components/backend-selection';
import type { CompanionConversation, CompanionHistoryState } from '../../src/companion-port';
import { handler } from './native';
import FilePreviewPane from './FilePreviewPane.vue';
import { createTranscriptFiles } from './transcript-files';
import { TranscriptReplicas } from '../../src/transcript-replica';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionCheckpoint } from '@workspace/core/companion-journal';

const frame = shallowRef<CompanionConversation | null>(null);
const agent = shallowRef<Agent | null>(null);
const agents = shallowRef<Agent[]>([]);
const ready = shallowRef(false);
const files = createTranscriptFiles({ readContent: readConversationContent, agentId: () => agent.value?.id,
  revision: () => JSON.stringify([agent.value?.readState?.revision, agent.value?.updatedAt]),
  post: event => { void handler('transcript').postMessage(JSON.stringify(event)); } });
const engines = shallowRef<{ current: string; choices: string[] } | null>(null);
const insets = reactive({ top: 0, bottom: 0, leading: 0, trailing: 0 });
const history = shallowRef<CompanionHistoryState>({ hasOlder: false, loadingOlder: false, failed: false });
provide(backendChoicesKey, computed(() => [...new Set(agents.value.map((candidate) => candidate.backend))]));

const messages = computed(() => frame.value?.payload.snapshot.messages ?? []);
const repository = computed(() => agent.value?.workspace?.kind === 'git' ? agent.value.workspace : null);
const imageLoading = shallowRef(false);
let imageOpenEpoch = 0;
const imageRequests = new Map<string, { agentId: string; resolve: (source: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function readImage(path: string): Promise<string> {
  const agentId = agent.value?.id;
  if (!agentId) return Promise.reject(new Error('No conversation.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { imageRequests.delete(requestId); reject(new Error('Image request timed out.')); }, 30_000);
    imageRequests.set(requestId, { agentId, resolve, reject, timer });
    void handler('transcript').postMessage(JSON.stringify({ type: 'readConversationImage', requestId, agentId, path }));
  });
}
function setImage(json: string) {
  const reply = JSON.parse(json) as { requestId: string; agentId: string; dataUrl?: string; error?: string };
  const pending = imageRequests.get(reply.requestId);
  if (!pending) return;
  imageRequests.delete(reply.requestId); clearTimeout(pending.timer);
  if (reply.agentId !== pending.agentId || agent.value?.id !== pending.agentId || reply.error || !reply.dataUrl) pending.reject(new Error('Image is unavailable.'));
  else pending.resolve(reply.dataUrl);
}
provideCodexHostCapabilities({
  capabilities: { attachments: false, clipboard: false, externalLinks: true, transcription: false },
  readImagePreview: readImage,
  async copyToClipboard(content) { await navigator.clipboard.writeText(content.text); },
  async ingestAttachments() { return []; }, async pickAttachments() { return []; },
  async transcribeAudio() { throw new Error('Native composer owns dictation.'); },
  async openExternal(url) { await handler('transcript').postMessage(JSON.stringify({ type: 'openExternal', url })); },
}, { imagePreviewBudgetBytes: 24 * 1024 * 1024 });
async function openFileImage(path: string, title: string) {
  const agentId = agent.value?.id;
  const epoch = ++imageOpenEpoch;
  imageLoading.value = true;
  let src = '';
  try { src = await readImage(path); } catch { /* The native viewer presents an unavailable state. */ }
  finally { if (epoch === imageOpenEpoch) imageLoading.value = false; }
  if (epoch === imageOpenEpoch && agentId && agentId === agent.value?.id) void handler('transcript').postMessage(JSON.stringify({ type: 'openImage', agentId, title, src }));
}
const contentRequests = new Map<string, { agentId: string; sessionId: string; resolve: (chunk: ConversationContentChunk) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function readConversationContent(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { contentRequests.delete(requestId); reject(new Error('Content request timed out.')); }, 30_000);
    contentRequests.set(requestId, { agentId, sessionId: input.sessionId, resolve, reject, timer });
    void handler('transcript').postMessage(JSON.stringify({ type: 'readConversationContent', requestId, agentId, input }));
  });
}

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
  actions: {
    loadOlderHistory: loadOlder,
    openLink(link) {
      if (link.kind === 'external') void handler('transcript').postMessage(JSON.stringify({ type: 'openExternal', url: link.href }));
      else if (/\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(link.path)) void openFileImage(link.path, link.path.split(/[\\/]/).at(-1) || 'Image');
      else files.open({ ...(link.diffContent ? { diffContent: link.diffContent } : {}), path: link.path, ...(link.action ? { action: link.action } : {}), ...(link.turnId ? { turnId: link.turnId } : {}), ...(link.line ? { line: link.line } : {}) });
    },
    async openImage(image) {
      const agentId = agent.value?.id;
      let src = /^(https?:|data:image\/)/i.test(image.src) ? image.src : '';
      if (!src && !image.src.startsWith('blob:')) { await openFileImage(image.src, image.title || image.name || image.alt || 'Image'); return true; }
      // Blob URLs belong to this WebView; pass their displayed bytes rather than a device-local URL.
      if (image.src.startsWith('blob:')) {
        try {
          const blob = await (await fetch(image.src)).blob();
          if (blob.size <= 20_000_000 && blob.type.startsWith('image/')) {
            src = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
          }
        } catch { /* The native viewer shows an unavailable state. */ }
      }
      if (agentId && agentId === agent.value?.id) {
        void handler('transcript').postMessage(JSON.stringify({ type: 'openImage', agentId, title: image.title || image.name || image.alt || 'Image', src }));
      }
      return true;
    },
  },
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

type Context = { agentId: string; generation: number; ready: boolean; agent: Agent | null; peers: { id: string; label: string }[]; history: CompanionHistoryState; engines: { current: string; choices: string[] } | null };
// The pane only needs the names of the agents a message may mention.
const peerAgents = (peers: Context['peers'] = []) => peers.map((peer) => ({ id: peer.id, name: peer.label }) as Agent);
let currentAgentId = '';
function applyContext(message: Context) {
  if (!message.ready || agent.value?.id !== message.agent?.id || JSON.stringify(agent.value?.backendSession) !== JSON.stringify(message.agent?.backendSession) || (fileGeneration !== message.generation)) files.reset();
  fileGeneration = message.generation;
  if (agent.value?.id !== message.agent?.id || JSON.stringify(agent.value?.backendSession) !== JSON.stringify(message.agent?.backendSession)) { ++imageOpenEpoch; imageLoading.value = false; }
  agent.value = message.agent; agents.value = peerAgents(message.peers);
  ready.value = message.ready ?? false; engines.value = message.engines ?? null;
  history.value = message.history ?? { hasOlder: false, loadingOlder: false, failed: false };
}

const replicas = new TranscriptReplicas();
let generation = -1;
let fileGeneration = -1;
let presentation = 0;
window.companionTranscript = {
  closeFile: files.close,
  setImage,
  async setTransfer(json: string) {
    const message = JSON.parse(json) as Context & { identity: string; checkpoint: CompanionCheckpoint; frames: ProviderConversationFrame[] };
    if (message.generation < generation) return null;
    generation = message.generation;
    if (!message.agent || message.frames.some(frame => frame.agentId !== message.agentId || frame.backend !== message.agent?.backend)) return { needsReset: true, identity: message.identity };
    const cached = replicas.apply(message.identity, message.checkpoint, message.frames);
    if (!cached) return { needsReset: true, identity: message.identity };
    const revision = ++presentation;
    currentAgentId = message.agentId; frame.value = cached.frame; applyContext(message);
    await nextTick();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (revision !== presentation) return null;
    return { identity: message.identity, checkpoint: cached.checkpoint, agentId: message.agent.id, revision: message.agent.readState?.revision ?? 0, generation: message.generation };
  },
  setContent(json) {
    if ((JSON.parse(json) as { type?: string }).type === 'conversationFile') { files.receive(JSON.parse(json)); return; }
    if ((JSON.parse(json) as { type?: string }).type === 'conversationImage') { setImage(json); return; }
    const reply = JSON.parse(json) as { requestId: string; agentId: string; sessionId: string; chunk?: ConversationContentChunk; error?: string };
    const pending = contentRequests.get(reply.requestId);
    if (!pending) return;
    contentRequests.delete(reply.requestId); clearTimeout(pending.timer);
    if (reply.agentId !== pending.agentId || reply.sessionId !== pending.sessionId || reply.agentId !== agent.value?.id
      || reply.sessionId !== (agent.value.backendSession?.kind === 'codex' ? agent.value.backendSession.threadId : agent.value.backendSession?.kind === 'claude' ? agent.value.backendSession.sessionId : null) || !reply.chunk || reply.error) pending.reject(new Error('Conversation changed.'));
    else pending.resolve(reply.chunk);
  },
  async setConversation(json) {
    const revision = ++presentation;
    const message = JSON.parse(json) as Context & { frame: CompanionConversation | null };
    generation = message.generation ?? generation;
    if (!message.agent) replicas.clear();
    currentAgentId = message.agentId ?? message.agent?.id ?? '';
    frame.value = message.frame;
    applyContext(message);
    if (!message.ready || !message.agent) return null;
    await nextTick();
    // Let the updated pane paint before the native shell removes its loading overlay.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return revision === presentation ? { agentId: message.agent.id, revision: message.agent.readState?.revision ?? 0, generation: message.generation } : null;
  },
  /** The chat's surroundings changed, not its conversation: a small update, applied only to the chat it was made for. */
  async setContext(json) {
    const message = JSON.parse(json) as Context;
    if (message.agentId !== currentAgentId || (message.generation !== undefined && message.generation < generation)) return null;
    if (JSON.stringify(message.agent?.backendSession) !== JSON.stringify(agent.value?.backendSession)) return null;
    const revision = presentation;
    applyContext(message);
    if (!message.ready || !message.agent) return null;
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return revision === presentation ? { agentId: message.agent.id, revision: message.agent.readState?.revision ?? 0, generation: message.generation } : null;
  },
  setInsets(top, bottom, leading = 0, trailing = 0) { insets.top = top; insets.bottom = bottom; insets.leading = leading; insets.trailing = trailing; },
};
</script>

<style>
html, body, #app { height: 100%; margin: 0; background: transparent; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
.transcript-layout { display: flex; height: 100%; width: 100%; overflow: hidden; }
.transcript-layout > .transcript { flex: 1; min-width: 0; }
.transcript-layout > .transcript-file { flex: 0 0 100%; box-sizing: border-box; padding: var(--transcript-top) var(--transcript-trailing) var(--transcript-bottom) var(--transcript-leading); }
.transcript-layout--preview > .transcript { display: none; }
@media (min-width: 700px) {
  .transcript-layout--preview > .transcript { display: flex; }
  .transcript-layout > .transcript-file { flex-basis: 50%; }
}
.transcript { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; box-sizing: border-box; padding: var(--transcript-top) var(--transcript-trailing) var(--transcript-bottom) var(--transcript-leading); }
/* History errors must not resize the reading viewport when shown or dismissed. */
.transcript__history-retry { position: absolute; z-index: 1; top: calc(var(--transcript-top) + 8px); left: calc(var(--transcript-leading) + 16px); right: calc(var(--transcript-trailing) + 16px); background: var(--color-surface-lowest); }
.transcript__media-status { position: absolute; z-index: 2; top: calc(var(--transcript-top) + 8px); left: calc(var(--transcript-leading) + 16px); right: calc(var(--transcript-trailing) + 16px); padding: 8px; text-align: center; color: var(--color-text-muted); background: var(--color-surface-lowest); }
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
/* Give the larger mobile text room without widening user bubbles. */
.transcript .codex-markdown.chat-user-text { padding-block: 10px; }
/* Native insets already reserve the composer; the hidden web footer has no height. */
.transcript .codex-conversation-pane__messages { --codex-scroll-to-bottom-offset: var(--space-12); }
/* The shared empty state frames its actions as a card; the engine control stands on its own. */
.transcript .conversation-pane__empty-actions { width: auto; padding: 0; border: 0; background: none; box-shadow: none; }
.transcript .conversation-pane__empty h1 { margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
.transcript .conversation-pane__empty p { margin: 0; line-height: 1.4; overflow-wrap: anywhere; color: var(--color-text-muted); }
/* A segmented control under the empty chat's title: the selected engine is raised, the others recede. */
.engine-picker { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--color-surface-base); }
.engine-picker__option { appearance: none; border: 0; background: transparent; color: var(--color-text-muted); font: inherit; font-size: 15px; font-weight: 500; padding: 8px 16px; border-radius: 999px; transition: background 0.15s, color 0.15s; -webkit-tap-highlight-color: transparent; }
.engine-picker__option--selected { background: var(--color-surface-lowest); color: var(--color-text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14); }
</style>
