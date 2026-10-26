<template>
  <section class="shared-conversation-pane">
  <CodexConversationPane
    :key="view.id"
    v-model="draft"
    :disabled="busy || view.status !== 'ready'"
    :capabilities="capabilities"
    :attach-enabled="false"
    :placeholder="t('guest.placeholder')"
    :busy="false"
    :conversation-key="view.id"
    @submit="propose"
    class="guest-transcript"
    :can-delete-turn="false"
    :can-edit-turn="false"
    :can-fork-turn="false"
    :can-retry-turn="false"
    follow-ups-disabled
    :history-loading="view.status === 'connecting'"
    :messages="snapshot?.messages ?? []"
    :turns="snapshot?.turns"
    :active-turn-id="snapshot?.activeTurnId"

    :has-older-history="snapshot?.historyState?.hasOlder ?? false"
    :loading-older-history="busy || view.status !== 'ready'"
    :tool-visibility="isAppToolVisible"
    :transform-message="transform"
    @load-older-history="control({ action: 'history', id: view.id })"
    @open-link="openLink"
  >
    <template #message-header="{ message }">
      <span v-if="author(message.id)" class="shared-conversation-pane__author">{{ author(message.id) }}</span>
      <DeferredConversationContent
        v-if="view.target && message.id && deferred(message.id) && !loaded.has(deferred(message.id)!.contentId) && view.status === 'ready'"
        :agent-id="view.target.agentId"
        :session-id="view.target.sessionId"
        :message-id="message.id!"
        :content="deferred(message.id)!"
        :read="readContent"
        @loaded="(id, full) => loaded.set(id, full)"
      />
    </template>
    <template #composer-drawers>
      <ConversationShareActivity v-if="visibleProposals.length" :proposals="visibleProposals" :disabled="busy || withdrawing || view.status !== 'ready'" @delete="withdraw" />
    </template>
    <template #before-composer>
      <p v-if="failed" role="alert">{{ t('guest.proposalFailed') }}</p>
      <p v-if="withdrawFailed" role="alert">{{ t('guest.deleteSuggestionFailed') }}</p>
    </template>
  </CodexConversationPane>
  </section>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CodexConversationPane, provideCodexHostCapabilities, useCodexHostCapabilities, type CodexChatMessage, type SurfaceMessage, type CodexConversationLink } from '@codex-app-sdk/vue';
import { guestConversationCapabilities } from '@workspace/core/guest-conversation';
import type { GuestJoinControl, GuestJoinView } from '@workspace/core/guest-navigation';
import type { RendererMessage } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { isAppToolVisible, provideAppToolPresentation } from '../tool-presentation';
import DeferredConversationContent from './DeferredConversationContent.vue';
import ConversationShareActivity from './ConversationShareActivity.vue';
const props = defineProps<{ view: GuestJoinView; busy: boolean; control: (input: GuestJoinControl) => Promise<boolean> }>();
const draft = ref(''); const failed = ref(false); const withdrawing = ref(false); const withdrawFailed = ref(false);
const visibleProposals = computed(() => props.view.proposalState?.proposals.filter(record => ['pending', 'queued', 'dispatching', 'unresolved'].includes(record.status)) ?? []);
async function withdraw(proposalId: string) {
  if (props.busy || withdrawing.value || props.view.status !== 'ready') return;
  withdrawing.value = true; withdrawFailed.value = false;
  try { withdrawFailed.value = !await props.control({ action: 'withdraw', id: props.view.id, proposalId }); }
  catch { withdrawFailed.value = true; }
  finally { withdrawing.value = false; }
}
let pending: { text: string; proposalId: string } | undefined;
const capabilities = { ...guestConversationCapabilities, planMode: false };
function author(id: string | undefined) { return props.view.proposalState?.authors.find(author => author.messageId === id)?.name ?? null; }
async function propose(text: string) {
  if (!text.trim() || props.view.status !== 'ready') return;
  if (!pending || pending.text !== text) pending = { text, proposalId: crypto.randomUUID() };
  failed.value = !await props.control({ action: 'propose', id: props.view.id, ...pending });
  if (failed.value) draft.value = text; else pending = undefined;
}
const { t } = useI18n();
provideAppToolPresentation((key, params) => t(key, params ?? {}));
const host = useCodexHostCapabilities();
// This subtree must never resolve an owner's file path through the local/native attachment host.
provideCodexHostCapabilities({
  capabilities: { attachments: false, clipboard: Boolean(host?.capabilities.clipboard), externalLinks: Boolean(host?.capabilities.externalLinks), transcription: false },
  copyToClipboard: content => host ? host.copyToClipboard(content) : Promise.resolve(),
  ingestAttachments: async () => [], pickAttachments: async () => [], transcribeAudio: async () => ({ text: '', error: 'Unavailable' }),
  openExternal: async href => { if (/^https?:\/\//i.test(href)) await host?.openExternal(href); },
  readImagePreview: async reference => {
    if (props.view.status !== 'ready' || !appApi) return null;
    try { return (await appApi.guestConversationImage(props.view.id, reference)).dataUrl; } catch { return null; }
  },
});
const snapshot = computed(() => props.view.frame?.payload.snapshot);
const loaded = reactive(new Map<string, RendererMessage>());
watch(() => [props.view.id, props.view.status === 'rejected', props.view.frame === null], () => loaded.clear());
function deferred(id: string | undefined) { const message = snapshot.value?.messages.find(message => message.id === id); return (message as RendererMessage | undefined)?.deferredContent; }
function transform(message: CodexChatMessage | SurfaceMessage) {
  const content = deferred(message.id); return content && loaded.has(content.contentId) ? loaded.get(content.contentId)! : message;
}
const readContent = (_agentId: string, input: import('@workspace/core/contracts/conversation').ConversationContentInput) => {
  if (!appApi || props.view.status !== 'ready') return Promise.reject(new Error('Guest unavailable.'));
  return appApi.guestConversationContent(props.view.id, input);
};
function openLink(link: CodexConversationLink) {
  if (link.kind === 'external' && /^https?:\/\//i.test(link.href)) void host?.openExternal(link.href);
}
</script>
<style scoped>
.shared-conversation-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.shared-conversation-pane__author { color: var(--color-text-muted); font-size: var(--font-size-12); }
.guest-transcript {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
