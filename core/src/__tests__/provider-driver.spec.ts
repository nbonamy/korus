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
  providerDisplayName,
  resolveProviderCoordinationPolicy,
  providerRuntimeFromSnapshot,
  unsupportedProviderFeature,
  type BackendEvent,
} from '../provider-driver';

describe('backend driver helpers', () => {
  it('resolves provider-independent legacy coordination defaults and explicit auth overrides', () => {
    expect(resolveProviderCoordinationPolicy()).toStrictEqual({ authentication: { actions: ['check', 'cancel', 'logout'], enableOnSuccess: true } });
    expect(resolveProviderCoordinationPolicy({ authentication: { actions: ['check', 'login'], enableOnSuccess: false } })).toStrictEqual({ authentication: { actions: ['check', 'login'], enableOnSuccess: false } });
  });
  it('uses product-facing backend names in unsupported feature errors', () => {
    expect(providerDisplayName('codex')).toBe('Codex');
    expect(providerDisplayName('claude')).toBe('Claude Code');
    expect(providerDisplayName('cursor')).toBe('Cursor');
    expect(unsupportedProviderFeature(agent('claude'), 'rollback').message)
      .toBe('Claude Code does not support rollback.');
  });

  it('finds a runtime in a snapshot and supplies a safe fallback', () => {
    const snapshot = createEmptySnapshot();
    snapshot.providerRuntimes = [{ provider: 'codex', status: 'running' }];

    expect(providerRuntimeFromSnapshot(snapshot, 'codex')).toStrictEqual({
      provider: 'codex',
      status: 'running',
    });
    expect(providerRuntimeFromSnapshot(snapshot, 'claude')).toStrictEqual({
      provider: 'claude',
      status: 'notConfigured',
    });
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
    expectTypeOf<Pick<SubagentOperationEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId' | 'source'>>()
      .toEqualTypeOf<{
        agentId: string;
        provider: Agent['provider'];
        conversationId?: string;
        turnId?: string;
        source?: 'provider' | 'client';
      }>();
    type DiffUpdatedEvent = Extract<BackendEvent, { type: 'conversation.turnDiffUpdated' }>;
    expectTypeOf<DiffUpdatedEvent['payload']>()
      .toEqualTypeOf<Omit<TurnGitDiff, 'agentId' | 'turnId' | 'updatedAt'>>();
    expectTypeOf<Pick<DiffUpdatedEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; provider: Agent['provider']; conversationId?: string; turnId: string }>();
    expectTypeOf<Extract<BackendEvent, { type: 'workspace.fileActivityDetected' }>['payload']>()
      .toEqualTypeOf<Omit<AgentFileActivity, 'agentId' | 'turnId' | 'occurredAt'>>();
    type GitStatusUpdatedEvent = Extract<BackendEvent, { type: 'git.statusUpdated' }>;
    expectTypeOf<GitStatusUpdatedEvent['payload']>().toEqualTypeOf<AgentGitStatus>();
    expectTypeOf<Pick<GitStatusUpdatedEvent, 'agentId' | 'provider' | 'conversationId' | 'turnId'>>()
      .toEqualTypeOf<{ agentId: string; provider?: Agent['provider']; conversationId?: string; turnId?: string }>();
    expectTypeOf<Extract<BackendEvent, { type: 'agentRequest.created' }>['payload']>()
      .toEqualTypeOf<{ request: import('../agent-request').AgentRequest }>();
    expectTypeOf<Extract<BackendEvent, { type: 'agentRequest.resolved' }>['payload']>()
      .toEqualTypeOf<{
        id: string; outcome: import('../agent-request').AgentRequestOutcome;
      }>();
    expectTypeOf<ConnectionEvent['seq']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ConnectionEvent['occurredAt']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ConnectionEvent['source']>().toEqualTypeOf<'provider' | 'client' | undefined>();
  });
});

function agent(provider: Agent['provider']): Agent {
  return {
    id: 'agent-dina',
    teamId: 'team-app',
    name: 'Dina',
    avatar: 'DI',
    folder: '/tmp/app',
    provider: provider,
    providerDefaults: provider === 'codex' ? { kind: 'codex' } : { kind: 'claude' },
    status: { type: 'idle' },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}
