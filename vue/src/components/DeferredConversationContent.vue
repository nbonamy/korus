<template>
  <span>
    <button class="app-button app-button--tertiary" type="button" :disabled="loading" @click="load">
      {{ loading ? t('chat.contentLoading') : t('chat.contentLoad') }}
    </button>
    <span v-if="failed" role="alert">{{ t('chat.contentFailed') }}</span>
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RendererMessage } from '@workspace/core/contracts';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import { appApi } from '../platform-api';

const props = defineProps<{
  agentId: string;
  sessionId: string;
  messageId: string;
  content: NonNullable<RendererMessage['deferredContent']>;
  read?: (agentId: string, input: ConversationContentInput) => Promise<ConversationContentChunk>;
}>();
const emit = defineEmits<{ loaded: [contentId: string, message: RendererMessage] }>();
const { t } = useI18n();
const loading = ref(false);
const failed = ref(false);
let generation = 0;
watch(() => [props.agentId, props.sessionId, props.messageId, props.content.contentId], () => { generation++; loading.value = false; failed.value = false; });
onBeforeUnmount(() => { generation++; });

async function load() {
  if (loading.value) return;
  const token = ++generation;
  const { agentId, sessionId, messageId, content } = props;
  const read = props.read ?? appApi?.readConversationContent;
  loading.value = true; failed.value = false;
  try {
    if (!read) throw new Error('Content is unavailable.');
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (true) {
      const chunk = await read(agentId, { sessionId, contentId: content.contentId, offset });
      if (token !== generation) return;
      const bytes = Uint8Array.from(atob(chunk.data), (character) => character.charCodeAt(0));
      if (!bytes.length || bytes.length > 64 * 1024 || chunk.totalBytes !== content.byteLength || offset + bytes.length > content.byteLength
        || chunk.nextOffset !== (offset + bytes.length < content.byteLength ? offset + bytes.length : null)) throw new Error('Invalid content chunk.');
      chunks.push(bytes);
      offset += bytes.length;
      if (chunk.nextOffset === null) break;
    }
    const bytes = new Uint8Array(offset);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as RendererMessage;
    if (message.id !== messageId || message.agentId !== agentId || !Array.isArray(message.parts)) throw new Error('Conversation content identity mismatch.');
    emit('loaded', content.contentId, message);
  } catch { if (token === generation) failed.value = true; }
  finally { if (token === generation) loading.value = false; }
}
</script>
