import type { ProviderConversationFrame } from '@workspace/core/contracts';
import type { CompanionSync } from '@workspace/core/companion-journal';
import { isConversationReset, type CompanionReset } from '@workspace/core/companion-protocol';
import type { GuestConversationUpdate, GuestConversationSync } from '@workspace/core/guest-conversation';
import { createCodexConversationReplica } from '@codex-app-sdk/core/conversation-replica';
import { createClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import { createAntigravityConversationReplica } from '@workspace/core/antigravity-conversation-replica';

/** Keep only the routing envelope. App snapshots, proposals and workspace projections never cross this boundary. */
export function guestConversationFrame(frame: ProviderConversationFrame): GuestConversationUpdate {
  const { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } = frame;
  const clean = { type, agentId, backend, threadId, backendSessionId, conversationId, turnId, seq, occurredAt, payload } as ProviderConversationFrame;
  if (clean.type === 'codex.conversationSnapshotChanged') {
    const s = clean.payload.snapshot;
    // A conversation SDK snapshot also carries account/catalog/queue state for its owner UI.
    // Construct a read-only transcript projection with safe empty values for those SDK fields.
    clean.payload = { revision: clean.payload.revision, snapshot: {
      status: 'ready', authentication: { status: 'loaded', account: null, requiresOpenaiAuth: false, error: null, login: { status: 'idle', loginId: null, authUrl: null, error: null } },
      activeConversationId: s.activeConversationId, activeTurnId: s.activeTurnId, turnIds: s.turnIds, turns: s.turns, messages: s.messages,
      busy: s.busy, historyLoading: s.historyLoading, contextUsage: s.contextUsage, goal: s.goal, turnGitDiff: s.turnGitDiff, threadStatus: s.threadStatus, error: s.error,
      ...(s.historyState ? { historyState: s.historyState } : {}), ...(s.executionPlan ? { executionPlan: s.executionPlan } : {}),
      conversations: [], clientRequests: [], answeredClientRequestIds: [], approvals: [], models: [], modelCatalogStatus: 'loaded', skills: [], skillCatalogStatus: 'loaded', plugins: [], pluginCatalogStatus: 'loaded', permissionProfiles: [], approvalPresets: [], approvalPreset: null, selectedModelId: null, selectedReasoningEffort: null, selectedServiceTier: null, planMode: false, rateLimits: null, queuedPrompts: [],
    } };
  } else if (clean.type === 'codex.conversationEventReceived') {
    const event = clean.payload.event;
    // Provider control/catalog and pending owner queues are not guest transcript traffic.
    const allowed = new Set(['conversation.historyReplaced', 'conversation.historyPrepended', 'conversation.historyStateChanged', 'conversation.activityChanged', 'conversation.goalChanged', 'conversation.contextUsageChanged', 'conversation.executionUsageChanged', 'conversation.diffUpdated', 'turn.started', 'turn.completed', 'turn.error', 'message.appended', 'message.delta', 'message.updated', 'tool.started', 'tool.updated', 'tool.completed', 'file.activity', 'plan.delta', 'plan.updated', 'plan.completed', 'context.compactionStarted', 'context.compactionCompleted']);
    if (!allowed.has(event.type)) return { revision: clean.payload.revision };
  } else if (clean.type === 'antigravity.conversationSnapshotChanged') {
    clean.payload = { revision: clean.payload.revision, snapshot: { ...clean.payload.snapshot, clientRequests: [], answeredClientRequestIds: [] } };
  } else if (clean.type === 'antigravity.conversationEventReceived' && ['request.created', 'request.resolved'].includes(clean.payload.event.type)) return { revision: clean.payload.revision };
  return { frame: clean };
}
export function guestConversationSync(sync: CompanionSync): GuestConversationSync { return { checkpoint: sync.checkpoint, updates: sync.frames.map(guestConversationFrame) }; }

/** Cache routing/revisions around existing provider replicas; never reduce transcript events here. */
export class GuestConversationCache {
  snapshot: CompanionReset | null = null;
  private replica?: { apply(event: never): unknown; getSnapshot(): unknown };
  clear() { this.snapshot = null; this.replica = undefined; }
  receive(update: GuestConversationUpdate): boolean {
    const frame = 'frame' in update ? update.frame : null;
    const revision = frame?.payload.revision ?? ('revision' in update ? update.revision : -1);
    if (frame && isConversationReset(frame)) {
      this.replica = frame.type === 'codex.conversationSnapshotChanged' ? createCodexConversationReplica(frame.payload.snapshot)
        : frame.type === 'claude.conversationSnapshotChanged' ? createClaudeConversationReplica(frame.payload.snapshot) : createAntigravityConversationReplica(frame.payload.snapshot);
      this.snapshot = frame; return true;
    }
    const current = this.snapshot;
    if (!current || !this.replica) return false;
    if (revision <= current.payload.revision) return true;
    if (revision !== current.payload.revision + 1 || (frame && (frame.agentId !== current.agentId || frame.backend !== current.backend))) return false;
    try {
      if (frame && !isConversationReset(frame)) this.replica.apply(frame.payload.event as never);
      const snapshot = this.replica.getSnapshot(); if (!snapshot) return false;
      this.snapshot = { ...current, payload: { revision, snapshot } } as CompanionReset; return true;
    } catch { return false; }
  }
}
