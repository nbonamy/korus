import type { SessionPatch, SessionSnapshot } from '@korus-dev/multi-agent-sdk/contracts';
import type { HarnessProvider, ProviderCapabilities } from './contracts';
import type { ConversationShareTarget } from './conversation-sharing';

/** Shared navigation references carry no local execution or owner controls. */
export const guestConversationCapabilities: ProviderCapabilities = {
  codeReview: false, planReview: false, questions: false,
  plugins: false, conversationArchive: false, conversationResume: false,
  scopedExecution: false, remoteControl: false, conversationShare: false,
  attachments: false, models: false, skills: false, reasoningEffort: false,
  serviceTier: false, thinkingBudget: false, planMode: 'unsupported', goals: false,
  steerPrompt: false, interrupt: false, history: true, conversationFork: false,
  deleteTurn: false, editTurn: false, retryTurn: false, approvals: false, approvalPresets: [],
};
export const guestConversationLimit = 8;
export const guestOwnerLimit = 32;
export type GuestParticipant = { identity: string; name: string; discriminator: string };
export type GuestConversationJoined = { target: ConversationShareTarget; participant: GuestParticipant; title?: string };
type SessionStream = { agentId: string; provider: HarnessProvider };
type StreamPosition = { conversation: string | null; epoch: string };
/** What a guest receives of the shared conversation: neutral session state, a snapshot then revisioned patches within one stream. */
export type GuestConversationUpdate =
  | SessionStream & { type: 'conversation.sessionSnapshot'; payload: StreamPosition & { snapshot: SessionSnapshot } }
  | SessionStream & { type: 'conversation.sessionPatch'; payload: StreamPosition & { patch: SessionPatch } };
/** The shared conversation as a guest holds it. */
export type GuestConversationSession = SessionStream & StreamPosition & { snapshot: SessionSnapshot };
