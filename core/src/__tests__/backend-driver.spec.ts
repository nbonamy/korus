import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  Agent,
  AgentFileActivity,
  AgentGitStatus,
  AppSnapshot, BrowserAnnotation, SendPromptOptions,
  SubagentOperationChange,
  TurnGitDiff
} from '../contracts';
import { createEmptySnapshot } from '../snapshot';
import {
  backendDisplayName,
  resolveBackendCoordinationPolicy,
  backendRuntimeFromSnapshot,
  codexPromptOptions,
  unsupportedBackendFeature,
  type BackendEvent,
} from '../backend-driver';

describe('backend driver helpers', () => {
  it('resolves provider-independent legacy coordination defaults and explicit auth overrides', () => {
    expect(resolveBackendCoordinationPolicy()).toStrictEqual({ permissionModeScope: 'provider', rollbackStorageState: 'archived', authentication: { actions: ['check', 'cancel', 'logout'], refreshOnAdmission: false, enableOnSuccess: true } });
    expect(resolveBackendCoordinationPolicy({ permissionModeScope: 'conversation', rollbackStorageState: 'active', authentication: { actions: ['check', 'login'], refreshOnAdmission: true, enableOnSuccess: false } })).toStrictEqual({ permissionModeScope: 'conversation', rollbackStorageState: 'active', authentication: { actions: ['check', 'login'], refreshOnAdmission: true, enableOnSuccess: false } });
  });
  it('uses product-facing backend names in unsupported feature errors', () => {
    expect(backendDisplayName('codex')).toBe('Codex');
    expect(backendDisplayName('claude')).toBe('Claude Code');
    expect(backendDisplayName('cursor')).toBe('Cursor');
    expect(unsupportedBackendFeature(agent('claude'), 'rollback').message)
      .toBe('Claude Code does not support rollback.');
  });

  it('finds a runtime in a snapshot and supplies a safe fallback', () => {
    const snapshot = createEmptySnapshot();
    snapshot.backendRuntimes = [{ backend: 'codex', status: 'running' }];

    expect(backendRuntimeFromSnapshot(snapshot, 'codex')).toStrictEqual({
      backend: 'codex',
      status: 'running',
    });
    expect(backendRuntimeFromSnapshot(snapshot, 'claude')).toStrictEqual({
      backend: 'claude',
      status: 'notConfigured',
    });
  });

  it('extracts only Codex prompt options', () => {
    const codexOptions = {
      backendOptions: {
        kind: 'codex',
        model: 'gpt-5',
      },
    } as SendPromptOptions;
    const claudeOptions = {
      backendOptions: {
        kind: 'claude',
      },
    } as SendPromptOptions;

    expect(codexPromptOptions(codexOptions)).toBe(codexOptions.backendOptions);
    expect(codexPromptOptions(claudeOptions)).toBeUndefined();
    expect(codexPromptOptions(undefined)).toBeUndefined();
  });

  it('preserves typed payloads through the backend event input envelope', () => {
    type ConnectionEvent = Extract<BackendEvent, { type: 'snapshot.updated' }>;

    expectTypeOf<Extract<BackendEvent, { type: 'client.connectionChanged' }>>()
      .toEqualTypeOf<never>();
    expectTypeOf<Extract<BackendEvent, { type: 'snapshot.updated' }>['payload']>()
      .toEqualTypeOf<AppSnapshot>();
    expectTypeOf<Extract<BackendEvent, { type: 'browser.annotationCreated' }>['payload']>()
      .toEqualTypeOf<BrowserAnnotation>();
    type SubagentOperationEvent = Extract<BackendEvent, { type: 'subagent.operationChanged' }>;
    expectTypeOf<SubagentOperationEvent['payload']>().toEqualTypeOf<SubagentOperationChange>();
    expectTypeOf<Pick<SubagentOperationEvent, 'agentId' | 'backend' | 'threadId' | 'turnId' | 'source'>>()
      .toEqualTypeOf<{
        agentId: string;
        backend: Agent['backend'];
        threadId?: string;
        turnId?: string;
        source?: 'backend' | 'client';
      }>();
    type DiffUpdatedEvent = Extract<BackendEvent, { type: 'conversation.turnDiffUpdated' }>;
    expectTypeOf<DiffUpdatedEvent['payload']>()
      .toEqualTypeOf<Omit<TurnGitDiff, 'agentId' | 'turnId' | 'updatedAt'>>();
    expectTypeOf<Pick<DiffUpdatedEvent, 'agentId' | 'backend' | 'threadId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; backend: Agent['backend']; threadId?: string; turnId: string }>();
    expectTypeOf<Extract<BackendEvent, { type: 'workspace.fileActivityDetected' }>['payload']>()
      .toEqualTypeOf<Omit<AgentFileActivity, 'agentId' | 'turnId' | 'occurredAt'>>();
    type GitStatusUpdatedEvent = Extract<BackendEvent, { type: 'git.statusUpdated' }>;
    expectTypeOf<GitStatusUpdatedEvent['payload']>().toEqualTypeOf<AgentGitStatus>();
    expectTypeOf<Pick<GitStatusUpdatedEvent, 'agentId' | 'backend' | 'threadId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; backend?: Agent['backend']; threadId?: string; turnId?: string }>();
    expectTypeOf<Extract<BackendEvent, { type: 'agentRequest.created' }>['payload']>()
      .toEqualTypeOf<{ request: import('../agent-request').AgentRequest }>();
    expectTypeOf<Extract<BackendEvent, { type: 'agentRequest.resolved' }>['payload']>()
      .toEqualTypeOf<{
        id: string; outcome: import('../agent-request').AgentRequestOutcome;
      }>();
    expectTypeOf<ConnectionEvent['seq']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ConnectionEvent['occurredAt']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ConnectionEvent['source']>().toEqualTypeOf<'backend' | 'client' | undefined>();
  });
});

function agent(backend: Agent['backend']): Agent {
  return {
    id: 'agent-dina',
    teamId: 'team-app',
    name: 'Dina',
    avatar: 'DI',
    folder: '/tmp/app',
    backend,
    backendDefaults: backend === 'codex' ? { kind: 'codex' } : { kind: 'claude' },
    status: { type: 'idle' },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}
