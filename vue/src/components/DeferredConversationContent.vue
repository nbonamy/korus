<template>
  <!-- Nothing to see or press: a cut row fills in by itself, or stays as its preview. -->
  <span hidden />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { RendererMessage } from '@workspace/core/contracts';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
import { appApi } from '../platform-api';
import { acquireContentRead, releaseContentRead } from './deferred-content-queue';

const props = defineProps<{
  agentId: string;
  sessionId: string;
  messageId: string;
  content: NonNullable<RendererMessage['deferredContent']>;
  read?: (agentId: string, input: ConversationContentInput) => Promise<ConversationContentChunk>;
  /** Rows up to this size are read as soon as they appear; larger ones keep their preview. */
  automaticBytes?: number;
}>();
const emit = defineEmits<{ loaded: [contentId: string, message: RendererMessage] }>();
// A cut row is read in the background as soon as it is on screen. Past this size it is not worth the trip: the cut parts of such a row
// are screenshots and dumps, and the preview already shows how they start.
const automatic = computed(() => props.content.byteLength <= (props.automaticBytes ?? 4 * 1024 * 1024));
const loading = ref(false);
let generation = 0;
watch(() => [props.agentId, props.sessionId, props.messageId, props.content.contentId], () => { generation++; loading.value = false; if (automatic.value) void load(); });
onMounted(() => { if (automatic.value) void load(); });
onBeforeUnmount(() => { generation++; });

async function load() {
  if (loading.value) return;
  const token = ++generation;
  const { agentId, sessionId, messageId, content } = props;
  const read = props.read ?? appApi?.readConversationContent;
  if (!read) return;
  loading.value = true;
  await acquireContentRead();
  try {
    if (token !== generation) return;
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
  } catch { /* The preview stays; there is nothing to press. */ }
  finally { releaseContentRead(); if (token === generation) loading.value = false; }
}
</script>
