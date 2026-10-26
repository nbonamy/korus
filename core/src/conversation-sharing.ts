import type { ShareRoutingStatus } from './conversation-share-relay';
import type { Agent, BackendConversationRef } from './contracts';
import { conversationRefFromAgent } from './conversation-ref';
import { companionPeerIdPattern, relayAddress } from './companion-relay';
import { product } from './product';

export type ShareRelay = { origin: string; peerId: string };
export type ConversationShareRoute = { relay: ShareRelay; ownerId: string; handle: string };
export type ConversationShareLink = { v: 1; relay: ShareRelay; ownerId: string; handle: string; credential: string };
/** Both execution identity and history identity are immutable grant bindings. */
export type ConversationShareTarget = { agentId: string; backend: Agent['backend']; sessionId: string; conversation: BackendConversationRef };
export type ConversationShareState = { active: boolean; handle: string | null; connectedGuests: number | null; availability: ShareRoutingStatus | 'transportPending' | 'notConfigured' };
export type ConversationShareControl = { target: ConversationShareTarget } & (
  | { action: 'status' | 'create' | 'copy' }
  | { action: 'revoke'; handle: string }
);
/** Only explicit create/copy responses contain bearer material. Never persist in renderer state. */
export type ConversationShareResult = { state: ConversationShareState; link?: string };

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
