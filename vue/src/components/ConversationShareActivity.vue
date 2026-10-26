<template>
  <section v-if="proposals.length" class="conversation-share-activity" :aria-label="t('sharing.guestProposals')">
    <article v-for="proposal in proposals" :key="proposal.id" class="conversation-share-activity__proposal">
      <strong>{{ proposal.name }} · {{ proposal.discriminator }}</strong>
      <p>{{ proposal.text }}</p>
      <template v-if="proposal.status === 'pending'">
        <el-button class="app-button" type="primary" :disabled="busy" @click="decide(proposal.id, 'send')">{{ t('guest.send') }}</el-button>
        <el-button class="app-button app-button--tertiary" :disabled="busy" @click="decide(proposal.id, 'dismiss')">{{ t('guest.dismiss') }}</el-button>
      </template>
      <span v-else role="status">{{ t(`guest.${proposal.status}`) }}</span>
    </article>
    <p v-if="failed" role="alert">{{ t('sharing.failed') }}</p>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConversationShareState, ConversationShareTarget, GuestAuthor } from '@workspace/core/conversation-sharing';
import { appApi } from '../platform-api';
const props = defineProps<{ target: ConversationShareTarget }>();
const emit = defineEmits<{ authors: [authors: GuestAuthor[]] }>();
const { t } = useI18n(); const state = ref<ConversationShareState | null>(null); const busy = ref(false); const failed = ref(false);
const proposals = computed(() => state.value?.proposals?.filter(proposal => ['pending', 'queued', 'dispatching', 'unresolved'].includes(proposal.status)) ?? []);
let disposed = false; let generation = 0; let unsubscribe: (() => void) | undefined;
function receive(value: ConversationShareState) { state.value = value; emit('authors', value.authors ?? []); }
async function load() {
  const expected = ++generation;
  try { const result = await appApi?.conversationShareControl({ action: 'status', target: props.target }); if (!disposed && expected === generation && result) receive(result.state); }
  catch { /* Sharing is inactive or unavailable; ordinary conversations remain usable. */ }
}
async function decide(proposalId: string, action: 'send' | 'dismiss') {
  if (busy.value || !state.value?.handle || !appApi) return;
  busy.value = true; failed.value = false;
  const expected = ++generation;
  try { const result = await appApi.conversationShareControl({ action, target: props.target, handle: state.value.handle, proposalId }); if (!disposed && expected === generation) receive(result.state); }
  catch { if (!disposed) failed.value = true; }
  finally { if (!disposed) busy.value = false; }
}
watch(() => JSON.stringify(props.target), () => { state.value = null; emit('authors', []); void load(); }, { immediate: true });
onMounted(() => { unsubscribe = appApi?.onEvent(event => { if (event.type === 'conversation.shareChanged' && event.agentId === props.target.agentId) { generation++; receive(event.payload); } }); });
onBeforeUnmount(() => { disposed = true; generation++; unsubscribe?.(); });
</script>
<style scoped>
.conversation-share-activity { padding: var(--space-8) var(--space-12); max-height: 35vh; overflow-y: auto; }
.conversation-share-activity__proposal { padding: var(--space-8); border-top: 1px solid var(--color-border); font-size: var(--font-size-13); }
.conversation-share-activity__proposal p { white-space: pre-wrap; margin: var(--space-8) 0; }
</style>
