import type { MainToRendererEvent } from './contracts';

export type SnapshotEventOwner = 'runtime' | 'coordination' | 'subagent' | 'renderer';

export const snapshotEventOwnership = {
  'antigravity.conversationSnapshotChanged': 'renderer',
  'antigravity.conversationEventReceived': 'renderer',
  'provider.authenticationChanged': 'renderer',
  'backend.statusChanged': 'runtime',
  'client.connectionChanged': 'renderer',
  'snapshot.updated': 'runtime',
  'account.rateLimitsUpdated': 'runtime',
  'remoteControl.statusChanged': 'renderer',
  'models.changed': 'renderer',
  'skills.changed': 'renderer',
  'codex.conversationSnapshotChanged': 'renderer',
  'codex.conversationEventReceived': 'renderer',
  'claude.conversationSnapshotChanged': 'renderer',
  'claude.conversationEventReceived': 'renderer',
  'client.markdownDisplayRequested': 'renderer',
  'plan.readyForReview': 'coordination',
  'plan.reviewResolved': 'coordination',
  'client.celebrationRequested': 'renderer',
  'agentCreation.progress': 'renderer',
  'mission.implementationStartProgress': 'renderer',
  'git.branchWorkProgress': 'renderer',
  'git.operationProgress': 'renderer',
  'browser.annotationCreated': 'renderer',
  'workItem.assignmentUpdated': 'runtime',
  'agent.updated': 'runtime',
  'agent.statusChanged': 'runtime',
  'agent.conversationAttached': 'runtime',
  'conversation.settingsUpdated': 'runtime',
  'conversation.modeUpdated': 'renderer',
  'conversation.goalUpdated': 'runtime',
  'conversation.goalCleared': 'runtime',
  'conversation.contextUsageUpdated': 'runtime',
  'conversation.historyLoadFailed': 'renderer',
  'subagent.operationChanged': 'subagent',
  'subagent.activityChanged': 'subagent',
  'subagent.identityChanged': 'subagent',
  'subagent.statusChanged': 'subagent',
  'agent.promptQueued': 'coordination',
  'agent.promptRetryScheduled': 'coordination',
  'agent.promptDequeued': 'coordination',
  'conversation.turnDiffUpdated': 'coordination',
  'workspace.fileActivityDetected': 'renderer',
  'git.statusUpdated': 'runtime',
  'agentRequest.created': 'coordination',
  'agentRequest.resolved': 'coordination',
} as const satisfies Record<MainToRendererEvent['type'], SnapshotEventOwner>;

export type SnapshotEventTypeOwnedBy<Owner extends SnapshotEventOwner> = {
  [Type in keyof typeof snapshotEventOwnership]:
    (typeof snapshotEventOwnership)[Type] extends Owner ? Type : never;
}[keyof typeof snapshotEventOwnership];

export type SnapshotEventOwnedBy<Owner extends SnapshotEventOwner> = Extract<
  MainToRendererEvent,
  { type: SnapshotEventTypeOwnedBy<Owner> }
>;

export type RendererOnlySnapshotEvent = SnapshotEventOwnedBy<'renderer'>;

export function isSnapshotEventOwnedBy<Owner extends SnapshotEventOwner>(
  event: MainToRendererEvent,
  owner: Owner,
): event is SnapshotEventOwnedBy<Owner> {
  return snapshotEventOwnership[event.type] === owner;
}
