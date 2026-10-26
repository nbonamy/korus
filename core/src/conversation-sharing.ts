import type { ShareRoutingStatus } from './conversation-share-relay';
import type { Agent, BackendConversationRef } from './contracts';
import { conversationRefFromAgent } from './conversation-ref';
import { companionPeerIdPattern, relayAddress } from './companion-relay';
import { product } from './product';
import { defaultBackendCapabilities } from './backend-capabilities';

export function supportsConversationSharing(agent: Agent | null | undefined): boolean {
  return Boolean(agent && !agent.sharedConversation && conversationShareTarget(agent) && defaultBackendCapabilities(agent.backend).conversationSharing === true);
}

export type ShareRelay = { origin: string; peerId: string };
export type ConversationShareRoute = { relay: ShareRelay; ownerId: string; handle: string };
export type ConversationShareLink = { v: 1; relay: ShareRelay; ownerId: string; handle: string; credential: string };
/** Both execution identity and history identity are immutable grant bindings. */
export type ConversationShareTarget = { agentId: string; backend: Agent['backend']; sessionId: string; conversation: BackendConversationRef };
export type GuestAuthor = { messageId: string; identity: string; name: string; discriminator: string };
export type GuestProposal = { id: string; handle: string; identity: string; name: string; discriminator: string; text: string; status: 'pending' | 'queued' | 'dispatching' | 'dismissed' | 'submitted' | 'rejected' | 'unresolved'; createdAt: string; messageId?: string; turnId?: string };
export type GuestProposalState = { proposals: GuestProposal[]; authors: GuestAuthor[] };
export type ConversationShareState = { active: boolean; handle: string | null; connectedGuests: number | null; availability: ShareRoutingStatus | 'transportPending' | 'notConfigured'; proposals?: GuestProposal[]; authors?: GuestAuthor[] };
export type ConversationShareControl = { target: ConversationShareTarget } & (
  | { action: 'status' | 'create' | 'copy' }
  | { action: 'revoke'; handle: string }
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

const handlePattern = /^[A-Za-z0-9_-]{32}$/;
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const maxLinkLength = 2048;
function validLink(link: ConversationShareLink): boolean {
  try {
    relayAddress(link.relay.origin, link.relay.peerId);
    return link.v === 1 && link.relay.origin.length <= 500 && companionPeerIdPattern.test(link.ownerId)
      && handlePattern.test(link.handle) && credentialPattern.test(link.credential);
  } catch { return false; }
}
export function encodeConversationShareLink(link: ConversationShareLink): string {
  if (!validLink(link)) throw new Error('Invalid conversation share link.');
  const query = new URLSearchParams({ v: '1', relay: link.relay.origin, relayPin: link.relay.peerId, owner: link.ownerId, handle: link.handle });
  const result = `${product.protocolScheme}://share?${query}#credential=${link.credential}`;
  if (result.length > maxLinkLength) throw new Error('Invalid conversation share link.');
  return result;
}
/** Require the operator/bundled relay pin, never a relay origin supplied solely by a link. */
export function decodeConversationShareLink(value: string, supportedRelay: ShareRelay): ConversationShareLink | null {
  if (typeof value !== 'string' || value.length > maxLinkLength) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== `${product.protocolScheme}:` || url.hostname !== 'share' || url.pathname || url.port || url.username || url.password) return null;
    const fields = ['v', 'relay', 'relayPin', 'owner', 'handle'];
    if ([...url.searchParams.keys()].length !== fields.length || fields.some(key => url.searchParams.getAll(key).length !== 1) || url.searchParams.get('v') !== '1') return null;
    const secret = /^#credential=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
    if (!secret) return null;
    const link: ConversationShareLink = { v: 1, relay: { origin: url.searchParams.get('relay')!, peerId: url.searchParams.get('relayPin')! }, ownerId: url.searchParams.get('owner')!, handle: url.searchParams.get('handle')!, credential: secret };
    if (!validLink(link) || link.relay.origin !== supportedRelay.origin || link.relay.peerId !== supportedRelay.peerId) return null;
    return link;
  } catch { return null; }
}

/** A pasteable, self-contained invitation; carries the same pinned bearer grant as the URL. */
export function encodeConversationInvitation(link: ConversationShareLink): string {
  // Validate before encoding, including the URL's size bound.
  encodeConversationShareLink(link);
  const { v, relay, ownerId, handle, credential } = link;
  const bytes = new TextEncoder().encode(JSON.stringify({ v, relay, ownerId, handle, credential }));
  const result = `KORUS1.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  if (result.length > maxLinkLength) throw new Error('Invalid conversation invitation.');
  return result;
}
export function decodeConversationInvitation(value: string, supportedRelay: ShareRelay): ConversationShareLink | null {
  if (typeof value !== 'string' || value.length > maxLinkLength) return null;
  const invitation = value.trim();
  if (!invitation.startsWith('KORUS1.')) return decodeConversationShareLink(invitation, supportedRelay);
  try {
    const encoded = invitation.slice(7);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
    const link = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ConversationShareLink;
    return decodeConversationShareLink(encodeConversationShareLink(link), supportedRelay);
  } catch { return null; }
}
