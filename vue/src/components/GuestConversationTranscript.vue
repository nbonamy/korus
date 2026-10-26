<template>
  <CodexMessageList
    :key="view.id"
    class="guest-transcript"
    actions-disabled
    :can-delete-turn="false"
    :can-edit-turn="false"
    :can-fork-turn="false"
    :can-retry-turn="false"
    follow-ups-disabled
    :messages="snapshot?.messages ?? []"
    :turns="snapshot?.turns"
    :active-turn-id="snapshot?.activeTurnId"
    :busy="snapshot?.busy"
    :has-older-messages="snapshot?.historyState?.hasOlder ?? false"
    :loading-older-messages="busy || view.status !== 'ready'"
    :tool-visibility="isAppToolVisible"
    :transform-message="transform"
    @load-older-messages="emit('older')"
    @open-link="openLink"
  >
    <template #header="{ message }">
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
  </CodexMessageList>
</template>
<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CodexMessageList, provideCodexHostCapabilities, useCodexHostCapabilities, type CodexChatMessage, type SurfaceMessage, type CodexConversationLink } from '@codex-app-sdk/vue';
import type { GuestJoinView } from '@workspace/core/guest-navigation';
import type { RendererMessage } from '@workspace/core/contracts';
import { appApi } from '../platform-api';
import { isAppToolVisible, provideAppToolPresentation } from '../tool-presentation';
import DeferredConversationContent from './DeferredConversationContent.vue';
const props = defineProps<{ view: GuestJoinView; busy: boolean }>();
const emit = defineEmits<{ older: [] }>();
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
.guest-transcript {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
