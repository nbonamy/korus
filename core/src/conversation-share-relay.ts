/** Guest routing is independent from claimed phone pairing codes and phone grants. */
export const shareAdmissionProtocol = '/workspace/conversation-share-admission/2.0.0';
export const shareRendezvousProtocol = '/workspace/conversation-share-rendezvous/2.0.0';
export const shareGuestProtocol = '/workspace/conversation-share/2.0.0';
export const shareInvitationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const shareHandlePattern = /^[A-Za-z0-9_-]{32}$/;
/** Global transient routing capacity, not an owner product quota. */
export const shareDirectoryCapacity = 5000;
/** Accommodates the full directory while bounding allocation before JSON decoding. */
export const shareAdmissionFrameLimit = 192 * 1024;
export const shareLookupFrameLimit = 4096;
export type ShareRoutingStatus = 'ready' | 'unavailable' | 'capacity' | 'rateLimited' | 'upgradeRequired';
