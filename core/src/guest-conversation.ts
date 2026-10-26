import type { BackendCapabilities, ProviderConversationFrame } from './contracts';
import type { CompanionCheckpoint } from './companion-journal';
import type { ConversationShareTarget } from './conversation-sharing';

/** Shared navigation references carry no local execution or owner controls. */
export const guestConversationCapabilities: BackendCapabilities = {
  conversationSharing: false, codeReview: false, planReview: false, questions: false,
  plugins: false, conversationArchive: false, conversationResume: false,
  conversationReplaceWithSummary: false, remoteControl: false,
  attachments: false, models: false, skills: false, reasoningEffort: false,
  serviceTier: false, thinkingBudget: false, planMode: 'unsupported', goals: false,
  steerPrompt: false, interrupt: false, history: true, conversationFork: false,
  deleteTurn: false, editTurn: false, retryTurn: false, approvals: false, approvalPresets: [],
};
export const guestConversationLimit = 8;
export const guestOwnerLimit = 32;
export type GuestParticipant = { identity: string; name: string; discriminator: string };
export type GuestConversationJoined = { target: ConversationShareTarget; participant: GuestParticipant; title?: string };
export type GuestConversationUpdate = { frame: ProviderConversationFrame } | { revision: number };
export type GuestConversationSync = { checkpoint: CompanionCheckpoint; updates: GuestConversationUpdate[] };
