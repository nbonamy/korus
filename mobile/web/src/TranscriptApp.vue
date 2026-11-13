<template>
  <div class="transcript-layout" :class="{ 'transcript-layout--preview': files.state.value }" :style="{ '--transcript-top': `${insets.top}px`, '--transcript-bottom': `${insets.bottom}px`, '--transcript-leading': `${insets.leading}px`, '--transcript-trailing': `${insets.trailing}px` }">
  <div class="transcript" :class="{ 'transcript--blocked': providerBlocked }">
    <button v-if="history.failed" class="app-button app-button--tertiary transcript__history-retry" @click="loadOlder">Couldn’t load earlier messages. Retry</button>
    <div v-if="imageLoading" class="transcript__media-status" role="status">Loading image…</div>
    <ImagePreviewScope :key="imageCacheScope">
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
    </ConversationPane>
    </ImagePreviewScope>
  </div>
  <FilePreviewPane v-if="files.state.value" :state="files.state.value" @close="files.close" @refresh="files.refresh" @mode="files.mode" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, nextTick, provide, reactive, shallowRef } from 'vue';
import { createConversationPaneController, provideHostCapabilities, type ConversationPaneState } from '@korus-dev/agent-ui-sdk';
import type { Agent } from '@workspace/core/contracts';
import { providerBlockFor } from '../../src/provider-block';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import ConversationPane from '@workspace/vue/components/ConversationPane.vue';
import { providerChoicesKey } from '@workspace/vue/components/provider-selection';
import type { CompanionConversation, CompanionHistoryState } from '../../src/companion-port';
import { handler } from './native';
import FilePreviewPane from './FilePreviewPane.vue';
import { createTranscriptFiles } from './transcript-files';
import { TranscriptReplicas } from '../../src/transcript-replica';
import { companionConversationOf, type CompanionConversationFrame } from '@workspace/core/companion-protocol';
import type { CompanionCheckpoint } from '@workspace/core/companion-journal';

const frame = shallowRef<CompanionConversation | null>(null);
const agent = shallowRef<Agent | null>(null);
const providerBlocked = computed(() => Boolean(providerBlockFor(agent.value)));
const agents = shallowRef<Agent[]>([]);
const ready = shallowRef(false);
const files = createTranscriptFiles({ readContent: readConversationContent, agentId: () => agent.value?.id,
  revision: () => JSON.stringify([agent.value?.readState?.revision, agent.value?.updatedAt]),
  post: event => { void handler('transcript').postMessage(JSON.stringify(event)); } });
const insets = reactive({ top: 0, bottom: 0, leading: 0, trailing: 0 });
const history = shallowRef<CompanionHistoryState>({ hasOlder: false, loadingOlder: false, failed: false });
provide(providerChoicesKey, computed(() => [...new Set(agents.value.map((candidate) => candidate.provider))]));

const messages = computed(() => frame.value?.payload.snapshot.state.messages ?? []);
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
const imageCacheScope = shallowRef('');
// The pool survives thread switches; changing its host/engine owner disposes it.
const ImagePreviewScope = defineComponent({ setup(_props, { slots }) {
  provideHostCapabilities({
  capabilities: { attachments: false, clipboard: false, externalLinks: true, transcription: false },
  readImagePreview: readImage,
  async copyToClipboard(content) { await navigator.clipboard.writeText(content.text); },
  async ingestAttachments() { return []; }, async pickAttachments() { return []; },
  async transcribeAudio() { throw new Error('Native composer owns dictation.'); },
  async openExternal(url) { await handler('transcript').postMessage(JSON.stringify({ type: 'openExternal', url })); },
}, { imagePreviewBudgetBytes: 64 * 1024 * 1024, viewportImageLoading: true });
  return () => slots.default?.();
} });
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
const turnRequests = new Map<string, { agentId: string; session: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function loadTurnHistory(turnId: string): Promise<void> {
  const agentId = agent.value?.id;
  if (!agentId) return Promise.reject(new Error('No conversation.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { turnRequests.delete(requestId); reject(new Error('Turn details request timed out.')); }, 60_000);
    turnRequests.set(requestId, { agentId, session: JSON.stringify(agent.value?.providerSession), resolve, reject, timer });
    void handler('transcript').postMessage(JSON.stringify({ type: 'loadTurnHistory', requestId, agentId, turnId }));
  });
}
function readConversationContent(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { contentRequests.delete(requestId); reject(new Error('Content request timed out.')); }, 30_000);
    contentRequests.set(requestId, { agentId, sessionId: input.sessionId, resolve, reject, timer });
    void handler('transcript').postMessage(JSON.stringify({ type: 'readConversationContent', requestId, agentId, input }));
  });
}

/** Read-only: the native app owns the composer and every interaction; this page only renders the conversation. */
const controller = createConversationPaneController({
  state: computed<ConversationPaneState>(() => {
    const state = frame.value?.payload.snapshot.state;
    return {
      identity: { conversationKey: agent.value?.id ?? null, messages: state?.messages ?? [], turns: state?.turns, activeTurnId: state?.activeTurnId, busy: state?.busy ?? false, disabled: true },
      history: { loading: false, hasOlder: history.value.hasOlder && !history.value.failed, loadingOlder: history.value.loadingOlder },
      thread: { approvals: [], clientRequests: [], answeredClientRequestIds: new Set<string>(), queuedPrompts: [], contextUsage: state?.contextUsage ?? null },
      composer: { state: { text: '', selectionStart: 0, selectionEnd: 0 } },
      capabilities: { models: false, skills: false, reasoningEffort: false, serviceTier: false, planMode: false, goals: false, steerPrompt: false, interrupt: false, history: true,
        deleteTurn: false, editTurn: false, retryTurn: false, approvals: false, approvalPresets: [] },
      policy: { attachEnabled: false, canDeleteTurn: false, canEditTurn: false, canForkTurn: false, canRetryTurn: false, actionsDisabled: true, followUpsDisabled: true },
    };
  }),
  actions: {
    loadOlderHistory: loadOlder,
    loadTurnHistory,
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


function loadOlder() {
  if (!agent.value || history.value.loadingOlder || !history.value.hasOlder) return;
  history.value = { ...history.value, loadingOlder: true, failed: false };
  void handler('transcript').postMessage(JSON.stringify({ type: 'loadOlder', agentId: agent.value.id }));
}

type Context = { engineInstance?: string; imageCacheScope?: string | null; agentId: string; generation: number; ready: boolean; agent: Agent | null; peers: { id: string; label: string }[]; history: CompanionHistoryState };
// The pane only needs the names of the agents a message may mention.
const peerAgents = (peers: Context['peers'] = []) => peers.map((peer) => ({ id: peer.id, name: peer.label }) as Agent);
let currentAgentId = '';
function applyContext(message: Context) {
  imageCacheScope.value = message.imageCacheScope === undefined ? message.engineInstance ?? '' : message.imageCacheScope ?? '';
  if (!message.ready || agent.value?.id !== message.agent?.id || JSON.stringify(agent.value?.providerSession) !== JSON.stringify(message.agent?.providerSession) || (fileGeneration !== message.generation)) files.reset();
  fileGeneration = message.generation;
  if (agent.value?.id !== message.agent?.id || JSON.stringify(agent.value?.providerSession) !== JSON.stringify(message.agent?.providerSession)) { ++imageOpenEpoch; imageLoading.value = false; }
  agent.value = message.agent; agents.value = peerAgents(message.peers);
  ready.value = message.ready ?? false;
  history.value = message.history ?? { hasOlder: false, loadingOlder: false, failed: false };
}

const replicas = new TranscriptReplicas();
let generation = -1;
let fileGeneration = -1;
let presentation = 0;
let engineInstance: string | undefined;
function bindEngine(message: Context) {
  if (message.engineInstance && message.engineInstance !== engineInstance) {
    engineInstance = message.engineInstance;
    generation = -1;
    ++presentation;
  }
}
window.companionTranscript = {
  closeFile: files.close,
  setImage,
  async setTransfer(json: string) {
    const message = JSON.parse(json) as Context & { identity: string; checkpoint: CompanionCheckpoint; frames: CompanionConversationFrame[] };
    bindEngine(message);
    if (message.generation < generation) return null;
    generation = message.generation;
    if (!message.agent || message.frames.some(frame => frame.agentId !== message.agentId || frame.provider !== message.agent?.provider)) return { needsReset: true, identity: message.identity };
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
    const message = JSON.parse(json) as { type?: string; requestId: string; agentId: string; error?: string };
    if (message.type === 'turnHistory') {
      const pending = turnRequests.get(message.requestId);
      if (!pending) return;
      turnRequests.delete(message.requestId); clearTimeout(pending.timer);
      if (message.error || message.agentId !== pending.agentId || agent.value?.id !== pending.agentId || JSON.stringify(agent.value.providerSession) !== pending.session) pending.reject(new Error(message.error ?? 'Conversation changed.'));
      else pending.resolve();
      return;
    }
    if ((JSON.parse(json) as { type?: string }).type === 'conversationFile') { files.receive(JSON.parse(json)); return; }
    if ((JSON.parse(json) as { type?: string }).type === 'conversationImage') { setImage(json); return; }
    const reply = JSON.parse(json) as { requestId: string; agentId: string; sessionId: string; chunk?: ConversationContentChunk; error?: string };
    const pending = contentRequests.get(reply.requestId);
    if (!pending) return;
    contentRequests.delete(reply.requestId); clearTimeout(pending.timer);
    if (reply.agentId !== pending.agentId || reply.sessionId !== pending.sessionId || reply.agentId !== agent.value?.id
      || reply.sessionId !== companionConversationOf(agent.value.providerSession) || !reply.chunk || reply.error) pending.reject(new Error('Conversation changed.'));
    else pending.resolve(reply.chunk);
  },
  async setConversation(json) {
    const message = JSON.parse(json) as Context & { frame: CompanionConversation | null };
    bindEngine(message);
    const revision = ++presentation;
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
    if (message.engineInstance && message.engineInstance !== engineInstance) return null;
    if (message.agentId !== currentAgentId || (message.generation !== undefined && message.generation < generation)) return null;
    if (JSON.stringify(message.agent?.providerSession) !== JSON.stringify(agent.value?.providerSession)) return null;
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
.transcript, .transcript :where(.agent-ui-theme) {
  --font-size-12: 14px;
  --font-size-13: 15px;
  --font-size-13-5: 15.5px;
  --font-size-14: 16px;
  --font-size-15: 17px;
  --line-height-20: 24px;
}
.transcript .agent-ui-workbench-layout__footer { display: none; }
.transcript--blocked .agent-ui-workbench-layout__footer { display: block; }
/* Give the larger mobile text room without widening user bubbles. */
.transcript .agent-ui-markdown.chat-user-text { padding-block: 10px; }
/* Native insets already reserve the composer; the hidden web footer has no height. */
.transcript .agent-ui-conversation-pane__messages { --agent-ui-scroll-to-bottom-offset: var(--space-12); }
.transcript .conversation-pane__empty h1 { margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
.transcript .conversation-pane__empty p { margin: 0; line-height: 1.4; overflow-wrap: anywhere; color: var(--color-text-muted); }
</style>
