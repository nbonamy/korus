import type { Agent, ModelFavorite, ProviderConversationFrame, Team } from './contracts';

export const companionProtocol = '/workspace/companion/1.0.0';
export const companionFrameLimit = 4 * 1024 * 1024;
// Authoritative provider snapshots grow as history pages are loaded. Requests keep
// the smaller limit; only responses from the paired laptop use this bound.
export const companionResponseLimit = 32 * 1024 * 1024;
export type CompanionTarget = { hostId: string; locationId: string; teamId: string; agentId: string; sessionId: string | null };
export type CompanionReset = Extract<ProviderConversationFrame, { type: 'codex.conversationSnapshotChanged' | 'claude.conversationSnapshotChanged' | 'antigravity.conversationSnapshotChanged' }>;
export type CompanionWorkspace = { teams: Team[]; agents: Agent[]; repositoryIcons?: Record<string, string>; modelFavorites?: ModelFavorite[] };
/** Shown on the laptop: the phone already knows the relay, so the code is all it needs. */
export type CompanionInvitation = { code: string; expiresAt: number };
/** A paired phone. Approval grants everything: every team, reading and sending. */
export type CompanionGrant = { peerId: string; name: string; createdAt: number };
export type CompanionPending = { id: string; peerId: string; name: string; expiresAt: number };
export type CompanionCommandReceipt = { clientCommandId: string; state: 'pending' | 'accepted' | 'unresolved'; target: CompanionTarget };
export type CompanionStatus = { configured: boolean; enabled: boolean; connected: boolean; hostId: string; relayOrigin: string; devices: CompanionGrant[]; pending: CompanionPending[]; error?: string };
export type CompanionControl =
  | { action: 'status' }
  | { action: 'enable'; relayOrigin: string; relayPeerId: string }
  | { action: 'disable' }
  | { action: 'invite' }
  | { action: 'decide'; pendingId: string; approve: boolean }
  | { action: 'revoke'; peerId: string };
export type CompanionControlResult = { status: CompanionStatus; invitation?: CompanionInvitation };
export type CompanionRequest = { v: 1; id: string; method: string; args: unknown };
export type CompanionResponse = { v: 1; id: string; result?: unknown; error?: string };

export function companionSessionId(agent: Agent): string | null {
  const session = agent.backendSession;
  if (!session) return null;
  return JSON.stringify(session.kind === 'codex' ? { kind: session.kind, threadId: session.threadId } : { kind: session.kind, sessionId: session.sessionId });
}
export function companionTarget(hostId: string, team: Team, agent: Agent): CompanionTarget {
  return { hostId, locationId: team.remoteConnectionId ?? 'local', teamId: team.id, agentId: agent.id, sessionId: companionSessionId(agent) };
}
/** App framing only. Cryptographic authentication and encryption are owned by Noise/libp2p. */
export function encodeCompanionFrame(value: unknown, limit = companionFrameLimit): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  if (payload.byteLength > limit) throw new Error('Companion frame too large.');
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength);
  frame.set(payload, 4);
  return frame;
}
export class CompanionFrameDecoder {
  private buffered = new Uint8Array(0);
  constructor(private readonly limit = companionFrameLimit) {}
  push(chunk: Uint8Array): unknown[] {
    const combined = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    combined.set(this.buffered); combined.set(chunk, this.buffered.byteLength);
    const frames: unknown[] = [];
    let offset = 0;
    while (combined.byteLength - offset >= 4) {
      const size = new DataView(combined.buffer, combined.byteOffset + offset, 4).getUint32(0);
      if (size > this.limit || size === 0) throw new Error('Invalid companion frame length.');
      if (combined.byteLength - offset - 4 < size) break;
      const payload = new TextDecoder('utf-8', { fatal: true }).decode(combined.subarray(offset + 4, offset + 4 + size));
      frames.push(JSON.parse(payload));
      offset += size + 4;
    }
    this.buffered = combined.slice(offset);
    if (this.buffered.byteLength > this.limit + 4) throw new Error('Companion buffer too large.');
    return frames;
  }
}
