import type { ProviderConversationFrame } from './contracts';
import type { CompanionCheckpoint } from './companion-journal';
import type { ConversationShareTarget } from './conversation-sharing';

export const guestConversationLimit = 8;
export const guestOwnerLimit = 32;
export type GuestParticipant = { identity: string; name: string; discriminator: string };
export type GuestConversationJoined = { target: ConversationShareTarget; participant: GuestParticipant; title?: string };
export type GuestConversationUpdate = { frame: ProviderConversationFrame } | { revision: number };
export type GuestConversationSync = { checkpoint: CompanionCheckpoint; updates: GuestConversationUpdate[] };
