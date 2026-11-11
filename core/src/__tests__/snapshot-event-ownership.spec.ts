import { describe, expect, expectTypeOf, it } from 'vitest';
import type { MainToRendererEvent } from '../contracts';
import { applyMainEventToSnapshot, createInitialSnapshot } from '../snapshot';
import { applyCoordinationEventToSnapshot } from '../snapshot-coordination-reducer';
import {
  isSnapshotEventOwnedBy,
  snapshotEventOwnership,
  type RendererOnlySnapshotEvent,
  type SnapshotEventOwnedBy,
  type SnapshotEventTypeOwnedBy,
} from '../snapshot-event-ownership';
import { applyRuntimeEventToSnapshot } from '../snapshot-runtime-reducer';
import { applySubagentEventToSnapshot } from '../snapshot-subagent-reducer';

const runtimeEventTypes = [
  'provider.statusChanged',
  'snapshot.updated',
  'account.rateLimitsUpdated',
  'workItem.assignmentUpdated',
  'agent.updated',
  'agent.statusChanged',
  'agent.conversationAttached',
  'conversation.settingsUpdated',
  'conversation.goalUpdated',
  'conversation.goalCleared',
  'conversation.contextUsageUpdated',
  'git.statusUpdated',
] as const satisfies readonly SnapshotEventTypeOwnedBy<'runtime'>[];

const coordinationEventTypes = [
  'plan.readyForReview',
  'plan.reviewResolved',
  'agent.promptQueued',
  'agent.promptRetryScheduled',
  'agent.promptDequeued',
  'conversation.turnDiffUpdated',
  'agentRequest.created',
  'agentRequest.resolved',
] as const satisfies readonly SnapshotEventTypeOwnedBy<'coordination'>[];

const subagentEventTypes = [
  'subagent.operationChanged',
  'subagent.activityChanged',
  'subagent.identityChanged',
  'subagent.statusChanged',
] as const satisfies readonly SnapshotEventTypeOwnedBy<'subagent'>[];

const rendererEventTypes = [
  'conversation.shareChanged',
  'conversation.sessionSnapshot',
  'conversation.sessionPatch',
  'provider.authenticationChanged',
  'client.connectionChanged',
  'remoteControl.statusChanged',
  'models.changed',
  'skills.changed',
  'client.markdownDisplayRequested',
  'client.celebrationRequested',
  'agentCreation.progress',
  'mission.implementationStartProgress',
  'mission.focusRequested',
  'git.branchWorkProgress',
  'git.operationProgress',
  'browser.annotationCreated',
  'conversation.modeUpdated',
  'conversation.historyLoadFailed',
  'workspace.fileActivityDetected',
  'turn.started',
  'turn.completed',
  'session.error',
  'tool.updated',
  'turn.output',
  'diff.updated',
  'file.activity',
] as const satisfies readonly SnapshotEventTypeOwnedBy<'renderer'>[];

const occurredAt = '2026-09-04T00:00:00.000Z';
const base = { seq: 1, occurredAt } as const;
const agent = { ...base, agentId: 'agent-dina' } as const;
const rendererOnlyEvents = [
  { ...agent, type: 'conversation.shareChanged', payload: { active: false, handle: null, connectedGuests: null, availability: 'transportPending' } },
  {
    ...base,
    type: 'client.connectionChanged',
    payload: { status: 'connected' },
  },
  {
    ...base,
    type: 'remoteControl.statusChanged',
    payload: { status: 'connected' },
  },
  {
    ...base,
    type: 'models.changed',
    provider: 'codex',
    payload: { models: [{ id: 'gpt', model: 'gpt', displayName: 'GPT' }] },
  },
  {
    ...base,
    type: 'skills.changed',
    provider: 'codex',
    payload: {
      cwd: null,
      status: 'loaded',
      skills: [{ name: 'test', path: '/skill', enabled: true }],
    },
  },
  {
    ...agent,
    type: 'client.markdownDisplayRequested',
    payload: { kind: 'markdown', content: '# Plan' },
  },
  {
    ...agent,
    type: 'client.celebrationRequested',
    payload: { kind: 'stars' },
  },
  {
    ...agent,
    type: 'agentCreation.progress',
    payload: {
      id: 'creation-1',
      state: 'running',
      provider: 'codex',
      repositoryName: 'repo',
      createWorktree: true,
      hasPrompt: true,
    },
  },
  {
    ...base,
    type: 'mission.implementationStartProgress',
    payload: {
      missionId: 'mission-1',
      phase: 'creatingWorktrees',
      repositoryCount: 2,
      ticketCount: 3,
    },
  },
  {
    ...agent,
    type: 'git.branchWorkProgress',
    payload: { id: 'branch-move-1', agentId: 'agent-dina', branchName: 'feature/work', state: 'running', phase: 'creatingWorktree' },
  },
  {
    ...agent,
    type: 'git.operationProgress',
    payload: { operation: 'merge', phase: 'delivery' },
  },
  {
    ...base,
    type: 'browser.annotationCreated',
    payload: {
      id: 'annotation-1',
      agentId: 'agent-dina',
      browserId: 'primary',
      url: 'https://example.com',
      kind: 'area',
      rect: { x: 1, y: 2, width: 3, height: 4 },
    },
  },
  {
    ...agent,
    provider: 'codex',
    threadId: 'thread-1',
    type: 'conversation.modeUpdated',
    payload: { mode: 'plan' },
  },
  {
    ...agent,
    type: 'conversation.historyLoadFailed',
    payload: { error: 'History unavailable' },
  },
  {
    ...agent,
    provider: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    type: 'workspace.fileActivityDetected',
    payload: {
      messageId: 'message-1',
      itemId: 'item-1',
      path: 'src/a.ts',
      action: 'edit',
      status: 'completed',
    },
  },
] as const satisfies readonly RendererOnlySnapshotEvent[];

describe('snapshot event ownership', () => {
  it('partitions every event type exactly once', () => {
    type OwnedEventType = keyof typeof snapshotEventOwnership;
    expectTypeOf<Exclude<MainToRendererEvent['type'], OwnedEventType>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<OwnedEventType, MainToRendererEvent['type']>>().toEqualTypeOf<never>();

    const expectedByOwner = {
      runtime: runtimeEventTypes,
      coordination: coordinationEventTypes,
      subagent: subagentEventTypes,
      renderer: rendererEventTypes,
    } as const;
    const assignedTypes = Object.values(expectedByOwner).flat();

    expect(new Set(assignedTypes).size).toBe(assignedTypes.length);
    for (const [owner, types] of Object.entries(expectedByOwner)) {
      expect(
        Object.entries(snapshotEventOwnership)
          .filter(([, assignedOwner]) => assignedOwner === owner)
          .map(([type]) => type),
      ).toEqual(types);
    }
  });

  it('gives each reducer only its owned event subset', () => {
    expectTypeOf<Parameters<typeof applyRuntimeEventToSnapshot>[1]>()
      .toEqualTypeOf<SnapshotEventOwnedBy<'runtime'>>();
    expectTypeOf<Parameters<typeof applyCoordinationEventToSnapshot>[1]>()
      .toEqualTypeOf<SnapshotEventOwnedBy<'coordination'>>();
    expectTypeOf<Parameters<typeof applySubagentEventToSnapshot>[1]>()
      .toEqualTypeOf<SnapshotEventOwnedBy<'subagent'>>();
  });

  it('explicitly ignores renderer-owned events in the snapshot facade', () => {
    for (const event of rendererOnlyEvents) {
      const snapshot = createInitialSnapshot();
      const before = structuredClone(snapshot);

      expect(isSnapshotEventOwnedBy(event, 'renderer')).toBe(true);
      applyMainEventToSnapshot(snapshot, event);

      expect(snapshot).toStrictEqual(before);
    }
  });
});
