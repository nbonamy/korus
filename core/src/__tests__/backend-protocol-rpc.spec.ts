import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  HarnessProvider,
  AgentFileActivity,
  AgentGitStatus,
  AppSnapshot, BrowserAnnotation,
  ClientState, SubagentStatusChange,
  TurnGitDiff
} from '../contracts';
import { createInitialSnapshot } from '../snapshot';
import { isAppSnapshotGetResult, type AppBackendEvent } from '../backend-protocol/rpc';
import { isAppSnapshot, isClientState } from '../snapshot-guards';

describe('backend protocol guards', () => {
  it('recognizes complete snapshot/get results from daemon', () => {
    expect(isAppSnapshotGetResult({
      snapshot: createInitialSnapshot(),
      lastEventSeq: 17,
      clientState: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: true,
        shouldPreventDisplaySleepForRemoteAccess: false,
      },
    })).toBe(true);
  });

  it('rejects partial objects that only resemble snapshots', () => {
    expect(isAppSnapshot({
      teams: [],
      agents: [],
    })).toBe(false);
    expect(isAppSnapshotGetResult({
      snapshot: {
        teams: [],
        agents: [],
      },
      lastEventSeq: 17,
      clientState: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: false,
      },
    })).toBe(false);
  });

  it('rejects snapshot/get results with malformed nested snapshot state', () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerRuntimes[0]!.capabilities = {
      planMode: 'automatic',
    } as never;

    expect(isAppSnapshotGetResult({
      snapshot,
      lastEventSeq: 17,
      clientState: {
        sourceFolderPath: '/Users/nbonamy/src',
        shouldPreventDisplaySleep: false,
      },
    })).toBe(false);
  });

  it('requires backend-derived client state in snapshot/get results', () => {
    expect(isClientState({
      sourceFolderPath: '/Users/nbonamy/src',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: true,
    })).toBe(true);
    expect(isClientState({
      sourceFolderPath: '/Users/nbonamy/src',
      shouldPreventDisplaySleep: false,
      shouldPreventDisplaySleepForRemoteAccess: 'yes',
    })).toBe(false);
    expect(isAppSnapshotGetResult({
      snapshot: createInitialSnapshot(),
      lastEventSeq: 17,
    })).toBe(false);
  });

  it('preserves typed payloads through the daemon event envelope', () => {
    type AnnotationEvent = Extract<AppBackendEvent, { type: 'browser.annotationCreated' }>;

    expectTypeOf<Extract<AppBackendEvent, { type: 'client.connectionChanged' }>>()
      .toEqualTypeOf<never>();
    type SnapshotUpdatedEvent = Extract<AppBackendEvent, { type: 'snapshot.updated' }>;
    expectTypeOf<SnapshotUpdatedEvent['payload']>().toEqualTypeOf<AppSnapshot>();
    expectTypeOf<Pick<SnapshotUpdatedEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{
        agentId?: string;
        provider?: HarnessProvider;
        conversationId?: string;
        turnId?: string;
      }>();
    expectTypeOf<SnapshotUpdatedEvent['snapshot']>().toEqualTypeOf<AppSnapshot | undefined>();
    expectTypeOf<AnnotationEvent['payload']>().toEqualTypeOf<BrowserAnnotation>();
    type SubagentStatusEvent = Extract<AppBackendEvent, { type: 'subagent.statusChanged' }>;
    expectTypeOf<SubagentStatusEvent['payload']>().toEqualTypeOf<SubagentStatusChange>();
    expectTypeOf<Pick<SubagentStatusEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{
        agentId: string;
      provider: 'codex' | 'claude' | 'antigravity' | 'cursor';
        conversationId?: string;
        turnId?: string;
      }>();
    type DiffUpdatedEvent = Extract<AppBackendEvent, { type: 'conversation.turnDiffUpdated' }>;
    expectTypeOf<DiffUpdatedEvent['payload']>()
      .toEqualTypeOf<Omit<TurnGitDiff, 'agentId' | 'turnId' | 'updatedAt'>>();
    expectTypeOf<Pick<DiffUpdatedEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; provider: HarnessProvider; conversationId?: string; turnId: string }>();
    expectTypeOf<Extract<AppBackendEvent, { type: 'workspace.fileActivityDetected' }>['payload']>()
      .toEqualTypeOf<Omit<AgentFileActivity, 'agentId' | 'turnId' | 'occurredAt'>>();
    type GitStatusUpdatedEvent = Extract<AppBackendEvent, { type: 'git.statusUpdated' }>;
    expectTypeOf<GitStatusUpdatedEvent['payload']>().toEqualTypeOf<AgentGitStatus>();
    expectTypeOf<Pick<GitStatusUpdatedEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; provider?: HarnessProvider; conversationId?: string; turnId?: string }>();
    expectTypeOf<Extract<AppBackendEvent, { type: 'agentRequest.created' }>['payload']>()
      .toEqualTypeOf<{ request: import('../agent-request').AgentRequest }>();
    expectTypeOf<Extract<AppBackendEvent, { type: 'agentRequest.resolved' }>['payload']>()
      .toEqualTypeOf<{
        id: string; outcome: import('../agent-request').AgentRequestOutcome;
      }>();
    expectTypeOf<AnnotationEvent['seq']>().toEqualTypeOf<number>();
    expectTypeOf<AnnotationEvent['occurredAt']>().toEqualTypeOf<string>();
    expectTypeOf<AnnotationEvent['clientState']>().toEqualTypeOf<ClientState | undefined>();
  });
});
