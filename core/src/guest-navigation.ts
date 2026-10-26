import type { CompanionReset } from './companion-protocol';
import type { GuestParticipant } from './guest-conversation';
import type { ConversationShareTarget } from './conversation-sharing';

export type GuestJoinStatus = 'needsName' | 'connecting' | 'ready' | 'unavailable' | 'rejected' | 'upgradeRequired' | 'busy' | 'invalid' | 'storageUnavailable';
export type GuestJoinEntry = { id: string; name: string; title: string; teamId?: string };
export type GuestJoinView = GuestJoinEntry & { status: GuestJoinStatus; participant: GuestParticipant | null; target: ConversationShareTarget | null; frame: CompanionReset | null; proposalState?: import('./conversation-sharing').GuestProposalState };
/** Renderer projections contain neither link credentials nor the protected app key. Transcript state is memory-only. */
export type GuestJoinState = { entries: GuestJoinEntry[]; view: GuestJoinView | null };
export type GuestJoinControl =
  | { action: 'state' }
  | { action: 'prepare'; link: string; teamId?: string }
  | { action: 'open' | 'leave' | 'history' | 'cancel'; id: string }
  | { action: 'join'; id: string; name: string }
  | { action: 'withdraw'; id: string; proposalId: string }
  | { action: 'propose'; id: string; proposalId: string; text: string };
