import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ConversationShareState, ConversationShareTarget } from '@workspace/core/conversation-sharing';
import { appApi } from '../platform-api';
import { conversationShareActiveByAgentIdKey } from './conversation-share-state';

export function useConversationShareActivity(target: () => ConversationShareTarget | null) {
  const state = ref<ConversationShareState | null>(null);
  const busy = ref(false); const failed = ref(false);
  const shareActiveByAgentId = inject(conversationShareActiveByAgentIdKey, null);
  const proposals = computed(() => state.value?.proposals?.filter(proposal => ['pending', 'queued', 'dispatching', 'unresolved'].includes(proposal.status)) ?? []);
  const authors = computed(() => state.value?.authors ?? []);
  let disposed = false; let generation = 0; let operation = 0; let unsubscribe: (() => void) | undefined;
  const key = () => JSON.stringify(target());
  function receive(value: ConversationShareState) {
    state.value = value;
    const current = target();
    if (current && shareActiveByAgentId) shareActiveByAgentId[current.agentId] = value.active;
  }
  async function load() {
    const current = target(); const expected = ++generation;
    if (!current) return;
    try {
      const result = await appApi?.conversationShareControl({ action: 'status', target: current });
      if (!disposed && expected === generation && result) receive(result.state);
    } catch { /* Ordinary conversations remain usable when sharing is unavailable. */ }
  }
  async function dismiss(proposalId: string): Promise<boolean> {
    const current = target(); const handle = state.value?.handle;
    if (busy.value || !current || !handle || !appApi) return false;
    busy.value = true; failed.value = false;
    const expected = ++generation; const identity = key(); const pending = ++operation;
    try {
      const result = await appApi.conversationShareControl({ action: 'dismiss', target: current, handle, proposalId });
      if (disposed || identity !== key()) return false;
      if (expected === generation) receive(result.state);
      return true;
    } catch { if (!disposed && identity === key()) failed.value = true; return false; }
    finally { if (!disposed && pending === operation) busy.value = false; }
  }
  watch(key, () => { state.value = null; failed.value = false; busy.value = false; operation++; void load(); }, { immediate: true });
  onMounted(() => {
    unsubscribe = appApi?.onEvent(event => {
      if (event.type === 'conversation.shareChanged' && event.agentId === target()?.agentId) { generation++; receive(event.payload); }
    });
  });
  onBeforeUnmount(() => { disposed = true; generation++; unsubscribe?.(); });
  return { proposals, authors, busy, failed, dismiss };
}
