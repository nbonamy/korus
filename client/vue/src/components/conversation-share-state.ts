import type { InjectionKey } from 'vue';
import type { ConversationShareState } from '@workspace/core/conversation-sharing';

export type ConversationSharePresence = Pick<ConversationShareState, 'active' | 'connectedGuests'>;
export const conversationSharePresenceByAgentIdKey: InjectionKey<Record<string, ConversationSharePresence>> = Symbol('conversation-share-presence-by-agent');
