import type { CompanionNotification } from './companion-notification';
import type { AgentRequest, AgentRequestResponse } from './agent-request';
import type { AccountRateLimits, Agent, HarnessProvider, AgentGitStatus, ModelFavorite, ProviderSessionData, Team } from './contracts';
import { applySessionPatch, sessionConversationId, type SessionPatch, type SessionSnapshot } from '@korus-dev/multi-agent-sdk/contracts';

// Conversations travel as neutral session state; a phone speaking an earlier version fails to negotiate.
export const companionProtocol = '/workspace/companion/3.0.0';
export const companionUpdatesProtocol = '/workspace/companion-updates/3.0.0';
/** Gzip responses are negotiated separately from plain JSON framing. */
export const companionCompressedProtocol = '/workspace/companion/4.0.0';
export const companionCompressedUpdatesProtocol = '/workspace/companion-updates/4.0.0';
export const companionDecodedResponseLimit = 128 * 1024 * 1024;
/** Match the native app lock: quick app switches retain the authenticated connection. */
export const companionBackgroundGraceMs = 5 * 60_000;
/** The update channel's liveness contract, shared by the phone and the laptop. */
export const companionHeartbeatIntervalMs = 15_000;
export const companionRequestTimeoutMs = 15_000;
export const companionIdleTimeoutMs = 45_000;
/** A backgrounded phone sends nothing, so the laptop waits out the grace period before calling a stream idle. */
export const companionBackgroundIdleTimeoutMs = companionBackgroundGraceMs + companionIdleTimeoutMs;
export type CompanionUpdate = { type: 'notification'; notification: CompanionNotification } | { type: 'workspace'; workspace: CompanionWorkspace } | { type: 'conversation'; frame: CompanionConversationFrame };
export const companionMaxUploadBytes = 2_500_000;
export const companionMaxUploads = 5;
export const companionFrameLimit = 4 * 1024 * 1024;
// Authoritative provider snapshots grow as history pages are loaded. Requests keep
// the smaller limit; only responses from the paired laptop use this bound.
export const companionResponseLimit = 32 * 1024 * 1024;
export type CompanionTarget = { hostId: string; locationId: string; teamId: string; agentId: string; sessionId: string | null };
export type CompanionRequestReply = { target: CompanionTarget; id: string; conversationId: string; outcome: AgentRequestResponse['outcome'] };
export type CompanionCloseOptions = { deleteWorktree: true; deleteRemoteBranch: boolean; discardChanges: boolean; confirmed: true };
export type CompanionClosePreview = { target: CompanionTarget } & import('./agent-close').AgentClosePreview;
/** A conversation event that carries its own revision, which still applies when the global event sequence already covers it. */
export const isConversationFrame = (frame: { type: string }): boolean =>
  frame.type === 'conversation.sessionSnapshot' || frame.type === 'conversation.sessionPatch';

/** Which stream a conversation frame belongs to: the provider conversation, and the session stream's identity. */
export type CompanionConversationStream = { conversation: string | null; epoch: string };
/** An agent's whole conversation as neutral session state, the base every patch applies to. */
export type CompanionConversation = { type: 'conversation.sessionSnapshot'; agentId: string; provider: HarnessProvider; payload: CompanionConversationStream & { snapshot: SessionSnapshot } };
export type CompanionConversationPatch = { type: 'conversation.sessionPatch'; agentId: string; provider: HarnessProvider; payload: CompanionConversationStream & { patch: SessionPatch } };
/** A conversation on the companion wire: a snapshot to start from, or a patch that follows it. */
export type CompanionConversationFrame = CompanionConversation | CompanionConversationPatch;
export const isCompanionConversationFrame = (frame: { type: string }): frame is CompanionConversationFrame =>
  frame.type === 'conversation.sessionSnapshot' || frame.type === 'conversation.sessionPatch';
export const isCompanionConversation = (frame: { type: string }): frame is CompanionConversation => frame.type === 'conversation.sessionSnapshot';
export const companionFrameRevision = (frame: CompanionConversationFrame): number =>
  frame.type === 'conversation.sessionSnapshot' ? frame.payload.snapshot.revision : frame.payload.patch.revision;
/** Only the conversation crosses to the phone, never the daemon's envelope around it. */
export function companionConversationFrame<F extends CompanionConversationFrame>(event: F): F {
  const { type, agentId, provider, payload } = event;
  return { type, agentId, provider, payload } as F;
}
type StreamOf = { agentId: string; payload: CompanionConversationStream };
export const sameCompanionStream = (a: StreamOf, b: StreamOf): boolean =>
  a.agentId === b.agentId && a.payload.epoch === b.payload.epoch && a.payload.conversation === b.payload.conversation;
/** The provider conversation an agent is attached to, as conversation frames name it. */
export const companionConversationOf = (session: ProviderSessionData | null | undefined): string | null =>
  !session ? null : sessionConversationId(session);
/** A frame belongs to the conversation the agent is attached to; before it attaches, a new conversation can already report. */
export function followsCompanionConversation(frame: CompanionConversationFrame, agent: Pick<Agent, 'id' | 'provider' | 'providerSession'>): boolean {
  const attached = companionConversationOf(agent.providerSession);
  return frame.agentId === agent.id && frame.provider === agent.provider
    && (frame.payload.conversation === null || attached === null || frame.payload.conversation === attached);
}

/**
 * The conversation after one more frame. A snapshot replaces it unless it is an older state of the same stream; a patch
 * applies in revision order within its stream. Returns `current` itself when the frame is stale, and null when the
 * stream broke (another stream's patch, a missed revision or an invalid patch): only a fresh snapshot continues it.
 */
export function followCompanionConversation(current: CompanionConversation | null, frame: CompanionConversationFrame): CompanionConversation | null {
  const same = current !== null && sameCompanionStream(current, frame);
  if (frame.type === 'conversation.sessionSnapshot') return same && frame.payload.snapshot.revision < current.payload.snapshot.revision ? current : companionConversationFrame(frame);
  if (!same) return null;
  if (frame.payload.patch.revision <= current.payload.snapshot.revision) return current;
  try { return { ...current, payload: { ...current.payload, snapshot: applySessionPatch(current.payload.snapshot, frame.payload.patch) } }; }
  catch { return null; }
}
export type CompanionGitStatus = Pick<AgentGitStatus, 'branch' | 'state' | 'changedFiles' | 'addedLines' | 'removedLines' | 'diffCatalog'>
  & { lastTurn?: { turnId: string; addedLines: number; removedLines: number } };
/** A ticket's progress as the desktop's implementation board shows it. */
export type CompanionMissionTicketState = 'blocked' | 'queued' | 'preparing' | 'running' | 'awaitingReview' | 'accepted' | 'cancelled' | 'failed';
export type CompanionReviewFinding = { id: string; priority: 'p0' | 'p1' | 'p2' | 'p3'; title: string; body: string;
  /** The repository's folder name, never its path on the laptop. */
  repository: string; file?: string; line?: number; endLine?: number;
  selected: boolean; state: 'open' | 'fixing' | 'fixed' | 'skipped' };
/** The review's verdict and findings, so a person can choose what to fix without opening the desktop. */
export type CompanionMissionReview = { summary: string; findings: CompanionReviewFinding[];
  /** The latest Review run has submitted its result; absent on older daemons. */
  ready?: boolean; runId?: string };
/** `agentId` is the worker implementing the ticket; it is listed in the workspace's `missionAgents`. */
/** `after` lists the numbers of the unfinished tickets this one waits for. */
export type CompanionMissionTicket = { number: number; title: string; state: CompanionMissionTicketState; agentId?: string; after?: number[];
  /** The repository's name, without its host path. */
  repository?: string;
  /** The run waiting for a person's acceptance, present only while the ticket is ready for review. */
  runId?: string };
/** What the phone knows of a mission: where it stands and its tickets, never its documents or workspaces. */
export type CompanionMission = { id: string; teamId: string; outcome: string; stage: import('./mission-types').MissionStage; status: 'active' | 'completed'; startedAt: string; updatedAt: string; tickets: CompanionMissionTicket[];
  /** The conversation that leads the mission through its current stage; an ordinary agent of the team. */
  leadAgentId?: string;
  /** Changes only with the mission; an action on it is refused if the mission moved on. */
  revision: number;
  /** What a person can do next: move implementation on to review, or ship (which only the desktop does). */
  next?: 'review' | 'ship';
  review?: CompanionMissionReview };
/** `backends` lists, per team, the engines that are connected and enabled on the laptop that hosts it. */
export type CompanionWorkspace = { conversationSync?: boolean; gitStatuses?: Record<string, CompanionGitStatus>; teams: Team[]; agents: Agent[]; repositoryIcons?: Record<string, string>; modelFavorites?: ModelFavorite[]; providers?: Record<string, HarnessProvider[]>; agentRequests?: Record<string, AgentRequest[]>; queuedPrompts?: { id: string; agentId: string; text: string }[];
  /** Active-round finding counts, keyed by reviewer conversation; full findings stay on demand. */
  reviewFindings?: Record<string, number>;
  /** Workers implementing mission tickets: openable from their mission, never listed among the team's agents. */
  missionProgress?: CompanionMission[]; missionAgents?: Agent[] };
/** Account quota windows on the paired laptop; billing and credit details stay on the host. */
export type CompanionUsage = { provider: HarnessProvider; limits: Pick<AccountRateLimits, 'primary' | 'secondary'> | null; failed: boolean };
/** A branch choice without host filesystem paths. */
export type CompanionBranch = { name: string; isDefault: boolean; isCheckedOut: boolean };
/** A new chat in a listed repository: default checkout, existing branch, or new worktree. */
export type CompanionNewChat = { teamId: string; repositoryId: string; selection: import('./contracts/execution').ExecutionSelectionOverrides & { provider: HarnessProvider }; existingBranch?: string; worktree?: { branchName: string } };
/** Project acquisition runs on the team's host; the phone sends no host filesystem paths. */
export type CompanionProjectInput = { teamId: string; selection: import('./contracts/execution').ExecutionSelectionOverrides & { provider: HarnessProvider }; source: 'new' | 'local' | 'github' | 'gitlab' | 'url'; value: string; branch?: string; worktree?: { branchName: string; baseBranch: string } };
export type CompanionProjectBranch = { name: string; isDefault: boolean };
export type CompanionRepositoryProvider = 'github' | 'gitlab';
/** Opaque selection bound to the owning daemon, host location and provider catalog. */
export type CompanionRepository = { id: string; name: string };
/** Legacy GitHub listing shape retained for existing native clients. */
export type CompanionGitHubRepository = CompanionRepository;
/** Image bytes resolved by the conversation's host, never a host-local file URL. */
export type CompanionImage = { dataUrl: string };
export type CompanionChatCreation = { state: 'running' } | { state: 'success'; agentId: string } | { state: 'error'; error: string };
/** Shown on the laptop: the phone already knows the relay, so the code is all it needs. */
export type CompanionInvitation = { code: string; expiresAt: number };
/** A paired phone. Approval grants everything: every team, reading and sending. */
export type CompanionGrant = { peerId: string; name: string; createdAt: number };
export type CompanionPending = { id: string; peerId: string; name: string; expiresAt: number };
export type CompanionCommandReceipt = { clientCommandId: string; state: 'pending' | 'accepted' | 'rejected' | 'unresolved'; target: CompanionTarget };
export type CompanionStatus = { configured: boolean; enabled: boolean; connected: boolean; hostId: string; relayOrigin: string; devices: CompanionGrant[]; pending: CompanionPending[]; error?: string };
export type CompanionControl =
  | { action: 'status' }
  | { action: 'resume' }
  | { action: 'enable'; relayOrigin: string; relayPeerId: string }
  | { action: 'disable' }
  | { action: 'invite' }
  | { action: 'decide'; pendingId: string; approve: boolean }
  | { action: 'revoke'; peerId: string };
export type CompanionControlResult = { status: CompanionStatus; invitation?: CompanionInvitation };
export type CompanionRequest = { v: 1; id: string; method: string; args: unknown };
export type CompanionResponse = { v: 1; id: string; result?: unknown; error?: string };

/** The harnesses the phone app and the relay's Live Activity schema name; others show on the phone without an engine. */
export const companionProviders = ['codex', 'claude', 'antigravity'] as const satisfies readonly HarnessProvider[];
export type CompanionProvider = typeof companionProviders[number];
/** The harnesses whose quotas shipped phone apps can label; others need negotiated labels and balances first. */
export const companionQuotaProviders: readonly HarnessProvider[] = ['codex', 'claude'];
/** Every agent the phone can open: the team's own and the workers implementing mission tickets. */
export const companionAgents = (workspace: Pick<CompanionWorkspace, 'agents' | 'missionAgents'>): Agent[] => workspace.missionAgents?.length ? [...workspace.agents, ...workspace.missionAgents] : workspace.agents;
/** The companion wire format names a session's conversation `threadId` (Codex) or `sessionId`, as shipped phones read it. */
const wireConversationField = (provider: HarnessProvider) => provider === 'codex' ? 'threadId' : 'sessionId';
/** Session data for the phone: the conversation under both its current and its wire name. */
export function withLegacyConversationId<T extends ProviderSessionData>(session: T): T {
  return { ...session, [wireConversationField(session.kind)]: session.conversationId };
}
export function companionSessionId(agent: Agent): string | null {
  const session = agent.providerSession;
  if (!session) return null;
  // The phone stores this id as the host wrote it, so its shape is part of the companion wire format.
  return JSON.stringify({ kind: session.kind, [wireConversationField(session.kind)]: session.conversationId });
}
export function companionTarget(hostId: string, team: Team, agent: Agent): CompanionTarget {
  return { hostId, locationId: agent.remoteConnectionId ?? 'local', teamId: team.id, agentId: agent.id, sessionId: companionSessionId(agent) };
}
/** App framing only. Cryptographic authentication and encryption are owned by Noise/libp2p. */
export function encodeCompanionFrame(value: unknown, limit = companionFrameLimit): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  return encodeCompanionPayload(payload, limit);
}
export function encodeCompanionPayload(payload: Uint8Array, limit: number): Uint8Array {
  if (payload.byteLength > limit) throw new Error('Companion frame too large.');
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength);
  frame.set(payload, 4);
  return frame;
}
export class CompanionFrameDecoder {
  private buffered = new Uint8Array(0);
  constructor(private readonly limit = companionFrameLimit, private readonly decode: (payload: Uint8Array) => unknown = decodeCompanionPayload) {}
  push(chunk: Uint8Array): unknown[] {
    const combined = new Uint8Array(this.buffered.byteLength + chunk.byteLength);
    combined.set(this.buffered); combined.set(chunk, this.buffered.byteLength);
    const frames: unknown[] = [];
    let offset = 0;
    while (combined.byteLength - offset >= 4) {
      const size = new DataView(combined.buffer, combined.byteOffset + offset, 4).getUint32(0);
      if (size > this.limit || size === 0) throw new Error('Invalid companion frame length.');
      if (combined.byteLength - offset - 4 < size) break;
      frames.push(this.decode(combined.subarray(offset + 4, offset + 4 + size)));
      offset += size + 4;
    }
    this.buffered = combined.slice(offset);
    if (this.buffered.byteLength > this.limit + 4) throw new Error('Companion buffer too large.');
    return frames;
  }
}
/** Decoded frames of a stream, in arrival order. */
export async function* readCompanionFrames(source: AsyncIterable<Uint8Array | { subarray(): Uint8Array }>, limit = companionFrameLimit): AsyncGenerator<unknown> {
  const decoder = new CompanionFrameDecoder(limit);
  for await (const chunk of source) yield* decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray());
}
/** The first frame of a one-shot stream; closing without one is an error. */
export async function readFirstCompanionFrame(source: AsyncIterable<Uint8Array | { subarray(): Uint8Array }>, limit = companionFrameLimit): Promise<unknown> {
  for await (const frame of readCompanionFrames(source, limit)) return frame;
  throw new Error('Stream closed without a frame.');
}

/** Strict JSON decoding shared by plain and negotiated compressed responses. */
export function decodeCompanionPayload(payload: Uint8Array): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
}
