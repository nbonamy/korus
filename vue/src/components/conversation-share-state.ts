import type { InjectionKey } from 'vue';

export const conversationShareActiveByAgentIdKey: InjectionKey<Record<string, boolean>> = Symbol('conversation-share-active-by-agent');
