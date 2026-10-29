import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { shareInvitationPattern } from './conversation-share-relay';
import type { ShareRoutingStatus } from './conversation-share-relay';
import type { Agent, BackendConversationRef } from './contracts';
import { conversationRefFromAgent } from './conversation-ref';
import { companionPeerIdPattern, relayAddress } from './companion-relay';
import { product } from './product';

export function supportsConversationSharing(agent: Agent | null | undefined): boolean {
  return Boolean(agent && !agent.sharedConversation && conversationShareTarget(agent));
}

export type ShareRelay = { origin: string; peerId: string };
export type ConversationShareRoute = { relay: ShareRelay; ownerId: string; handle: string };
/** Owner identity is discovered through the pinned relay and pinned locally on first connection. */
export type ConversationShareLink = { v: 2; relay: ShareRelay; ownerId?: string; handle: string; credential: string };
/** Both execution identity and history identity are immutable grant bindings. */
export type ConversationShareTarget = { agentId: string; backend: Agent['backend']; sessionId: string; conversation: BackendConversationRef };
export type GuestAuthor = { messageId: string; identity: string; name: string; discriminator: string };
export type GuestPromptInput = { id: string; text: string; followUpBehavior?: 'queue' | 'steer' };
export type GuestProposal = { id: string; handle: string; identity: string; name: string; discriminator: string; text: string; status: 'pending' | 'queued' | 'dispatching' | 'dismissed' | 'submitted' | 'rejected' | 'unresolved'; createdAt: string; messageId?: string; turnId?: string };
export type ConnectedConversationGuest = { identity: string; name: string; discriminator: string; writeAccess: boolean };
export type GuestProposalState = { proposals: GuestProposal[]; authors: GuestAuthor[]; writeAccess?: boolean };
export type ConversationShareState = { active: boolean; handle: string | null; connectedGuests: number | null; availability: ShareRoutingStatus | 'transportPending' | 'notConfigured'; proposals?: GuestProposal[]; authors?: GuestAuthor[]; guests?: ConnectedConversationGuest[] };
export type ConversationShareControl = { target: ConversationShareTarget } & (
  | { action: 'status' | 'create' | 'copy' }
  | { action: 'revoke'; handle: string }
  | { action: 'access'; handle: string; identity: string; writeAccess: boolean }
  | { action: 'send' | 'dismiss'; handle: string; proposalId: string }
);
/** Only explicit create/copy responses contain bearer material. Never persist in renderer state. */
export type ConversationShareResult = { state: ConversationShareState; link?: string; invitation?: string };

export function conversationShareTarget(agent: Agent): ConversationShareTarget | null {
  const conversation = conversationRefFromAgent(agent);
  const session = agent.backendSession;
  if (!conversation || !session || session.kind !== agent.backend) return null;
  const sessionId = session.kind === 'codex' ? session.threadId : session.sessionId;
  return sessionId ? { agentId: agent.id, backend: agent.backend, sessionId, conversation } : null;
}

/** Domain-separated routing hash; the relay never receives the UUID bearer. */
function handleFor(credential: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`conversation-share-v2:${credential}`))).slice(0, 32);
}
function validLink(link: ConversationShareLink): boolean {
  try {
    relayAddress(link.relay.origin, link.relay.peerId);
    return link.v === 2 && shareInvitationPattern.test(link.credential) && link.handle === handleFor(link.credential)
      && (link.ownerId === undefined || companionPeerIdPattern.test(link.ownerId));
  } catch { return false; }
}
export function encodeConversationShareLink(link: ConversationShareLink): string {
  return `${product.protocolScheme}://share/${encodeConversationInvitation(link)}`;
}
/** The relay configuration comes exclusively from Korus, never from an invitation. */
export function decodeConversationShareLink(value: string, supportedRelay: ShareRelay): ConversationShareLink | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== `${product.protocolScheme}:` || url.hostname !== 'share' || url.port || url.username || url.password || url.search || url.hash) return null;
    const credential = url.pathname.slice(1).toLowerCase();
    if (!shareInvitationPattern.test(credential) || value.toLowerCase() !== `${product.protocolScheme}://share/${credential}`) return null;
    return decodeConversationInvitation(credential, supportedRelay);
  } catch { return null; }
}
/** A UUIDv4 is the complete bearer invitation. Legacy formats are intentionally unsupported. */
export function encodeConversationInvitation(link: ConversationShareLink): string {
  if (!validLink(link)) throw new Error('Invalid conversation invitation.');
  return link.credential;
}
export function decodeConversationInvitation(value: string, supportedRelay: ShareRelay): ConversationShareLink | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const invitation = value.trim().toLowerCase();
  if (!shareInvitationPattern.test(invitation)) return decodeConversationShareLink(value.trim(), supportedRelay);
  const link: ConversationShareLink = { v: 2, relay: supportedRelay, handle: handleFor(invitation), credential: invitation };
  return validLink(link) ? link : null;
}
