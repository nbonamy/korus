import { onBeforeUnmount, onMounted, provide, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import type { Agent } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { appApi } from '../platform-api';
import { conversationSharePresenceByAgentIdKey, type ConversationSharePresence } from './conversation-share-state';

/** One owner per shell: status reads establish presence without announcing existing guests. */
export function useConversationSharePresence(agents: () => readonly Agent[]) {
  const presence = reactive<Record<string, ConversationSharePresence>>({});
  const { t } = useI18n();
  provide(conversationSharePresenceByAgentIdKey, presence);
  watch(() => Object.entries(presence).map(([agentId, state]) => ({ agentId, active: state.active, count: state.connectedGuests })), (entries, previous) => {
    const before = new Map(previous.map(state => [state.agentId, state]));
    for (const state of entries) {
      const old = before.get(state.agentId);
      if (!state.active || !old?.active || state.count === null || old.count === null || state.count <= old.count) continue;
      const agent = agents().find(agent => agent.id === state.agentId);
      if (!agent || agent.sharedConversation || agent.remoteConnectionId) continue;
      const count = state.count - old.count;
      ElMessage({ type: 'primary', message: t(count === 1 ? 'sharing.guestJoined' : 'sharing.guestsJoined', { chat: agentDisplayName(agent), count }) });
    }
  }, { flush: 'sync' });

  let unsubscribe: (() => void) | undefined;
  onMounted(() => {
    unsubscribe = appApi?.onEvent(event => {
      if (event.type === 'conversation.shareChanged') presence[event.agentId] = event.payload;
    });
  });
  onBeforeUnmount(() => unsubscribe?.());
  return presence;
}
