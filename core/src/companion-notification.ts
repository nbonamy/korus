import type { CompanionTarget } from './companion-protocol';

/** Attention metadata only: never prompts, answers, tool arguments or transcript excerpts. */
export type CompanionNotification = {
  id: string;
  target: CompanionTarget;
  kind: 'completed' | 'approval' | 'question';
  name: string;
  createdAt: number;
};
export type CompanionPushRegistration = {
  token: string;
  environment: 'development' | 'production';
  /** Omitted by existing Apple clients. */
  transport?: 'apns' | 'fcm';
  authorization?: { expiresAt: number; signature: string };
};
/** Phone consent is scoped to one relay, laptop, token, and expiry; it cannot authorize another recipient. */
export function companionPushAuthorizationMessage(relayId: string, hostId: string, peerId: string, registration: CompanionPushRegistration, expiresAt: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(registration.transport === 'fcm'
    ? ['companion-push-consent-v2', 'fcm', relayId, hostId, peerId, registration.token, registration.environment, expiresAt]
    : ['companion-push-consent-v1', relayId, hostId, peerId, registration.token, registration.environment, expiresAt]));
}
export const companionPushProtocol = '/workspace/companion-push/1.0.0';

export function isCompanionNotification(value: unknown): value is CompanionNotification {
  if (!value || typeof value !== 'object') return false;
  const n = value as CompanionNotification;
  return typeof n.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(n.id)
    && ['completed', 'approval', 'question'].includes(n.kind)
    && typeof n.name === 'string' && n.name.length <= 100 && Number.isFinite(n.createdAt)
    && Boolean(n.target && ['hostId', 'locationId', 'teamId', 'agentId'].every(key =>
      typeof n.target[key as keyof CompanionTarget] === 'string' && Boolean(n.target[key as keyof CompanionTarget]) && (n.target[key as keyof CompanionTarget]?.length ?? 0) <= 256)
      && (n.target.sessionId === null || typeof n.target.sessionId === 'string' && n.target.sessionId.length <= 1000));
}
