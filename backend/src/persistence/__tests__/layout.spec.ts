import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { approvalBackendDefaultsWithPreset } from '@workspace/core/approval-presets';
import type { AppSnapshot, ThreadGoal, ThreadPlan } from '@workspace/core/contracts';
import type { Visualization } from '@workspace/core/visualize';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../../state-persistence';
import { joinPersistedState, splitPersistedState } from '../layout';

const roundTrip = (snapshot: AppSnapshot) => snapshotFromPersistedState(joinPersistedState(splitPersistedState(persistedStateFromSnapshot(snapshot))));
const direct = (snapshot: AppSnapshot) => snapshotFromPersistedState(persistedStateFromSnapshot(snapshot));

const plan = (status: ThreadPlan['status']): ThreadPlan => ({ threadId: 't', turnId: 'turn', kind: 'execution', status, explanation: '', steps: [], markdown: '- [ ] do it', updatedAt: '2026-10-01T00:00:00.000Z' });
const goal = (status: ThreadGoal['status']): ThreadGoal => ({ threadId: 't', objective: 'ship it', status, tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 2 });
const withAgents = (count: number): AppSnapshot => {
  const snapshot = createInitialSnapshot();
  while (snapshot.agents.length < count) {
    const copy = { ...structuredClone(snapshot.agents[0]!), id: `agent-extra-${snapshot.agents.length}` };
    snapshot.agents.push(copy);
    snapshot.teams[0]!.agentIds.push(copy.id);
  }
  return snapshot;
};
const visualization = (id: string, createdAt: string): Visualization => ({ id, title: id, content: { kind: 'mermaid', source: 'flowchart LR; A --> B' }, createdAt, updatedAt: createdAt });

describe('store layout', () => {
  it('stores each agent as one engine block and restores the exact provider state', () => {
    const snapshot = withAgents(3);
    const [codex, claude, bare] = snapshot.agents;
    codex!.backendSession = { kind: 'codex', threadId: 'thread-1' };
    codex!.backendDefaults = { ...approvalBackendDefaultsWithPreset({ kind: 'codex', model: 'gpt-x', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null }, 'approve-for-me') };
    claude!.backend = 'claude';
    claude!.backendSession = { kind: 'claude', sessionId: 'session-1', transport: 'stdio', model: 'opus' };
    claude!.backendDefaults = { kind: 'claude', model: 'opus', thinking: { type: 'enabled', budgetTokens: 1024 } };
    delete bare!.backendDefaults;
    delete bare!.backendSession;

    const { roster } = splitPersistedState(persistedStateFromSnapshot(snapshot));

    expect(roster.agents[0]!.engine).toStrictEqual({
      kind: 'codex',
      session: { threadId: 'thread-1' },
      settings: { model: 'gpt-x', userSelectedModel: true, approvalPreset: 'approve-for-me', reasoningEffort: 'high', serviceTier: null },
    });
    expect(roster.agents[1]!.engine).toStrictEqual({
      kind: 'claude',
      session: { sessionId: 'session-1', transport: 'stdio', model: 'opus' },
      settings: { model: 'opus', thinking: { type: 'enabled', budgetTokens: 1024 } },
    });
    expect(roster.agents[2]!.engine).toStrictEqual({ kind: 'codex' });
    expect(roster.agents.some((agent) => 'backend' in agent || 'backendSession' in agent || 'backendDefaults' in agent || 'teamId' in agent)).toBe(false);
    const restored = roundTrip(snapshot);
    expect(restored.agents.map((agent) => [agent.backend, agent.backendSession, agent.backendDefaults]))
      .toStrictEqual(direct(snapshot).agents.map((agent) => [agent.backend, agent.backendSession, agent.backendDefaults]));
  });

  it('keeps Codex approval fields that no preset explains', () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.backendDefaults = { kind: 'codex', approvalPolicy: 'on-request', sandboxMode: 'read-only' };
    const { roster } = splitPersistedState(persistedStateFromSnapshot(snapshot));
    expect(roster.agents[0]!.engine).toStrictEqual({ kind: 'codex', settings: { approvalPolicy: 'on-request', sandboxMode: 'read-only' } });
  });

  it('drops finished execution state but retains the latest plan decision', () => {
    const snapshot = createInitialSnapshot();
    const [finished, active] = snapshot.agents;
    finished!.plan = plan('completed');
    finished!.goal = goal('complete');
    finished!.planReview = { id: 'review-1', conversationId: 'c', turnId: 't', markdown: '# Plan', status: 'accept' };
    active!.plan = plan('inProgress');
    active!.goal = goal('active');
    active!.planReview = { id: 'review-2', conversationId: 'c', turnId: 't', markdown: '# Plan', status: 'pending' };

    const restored = roundTrip(snapshot);

    expect(restored.agents[0]).not.toHaveProperty('plan');
    expect(restored.agents[0]).not.toHaveProperty('goal');
    expect(restored.agents[0]!.planReview?.status).toBe('accept');
    expect(restored.agents[1]!.plan?.status).toBe('inProgress');
    expect(restored.agents[1]!.goal?.status).toBe('active');
    expect(restored.agents[1]!.planReview?.status).toBe('pending');
  });

  it('keeps the selection on the active team so no global field can drift from it', () => {
    const snapshot = createInitialSnapshot();
    const selected = snapshot.agents[1]!.id;
    snapshot.activeAgentId = selected;
    snapshot.teams[0]!.activeAgentId = snapshot.agents[0]!.id;

    const { roster } = splitPersistedState(persistedStateFromSnapshot(snapshot));

    expect(roster.teams[0]!.activeAgentId).toBe(selected);
    expect(roundTrip(snapshot).activeAgentId).toBe(selected);
  });

  it('stores subagent nodes for existing agents and nothing derived from their operations', () => {
    const snapshot = createInitialSnapshot();
    const agentId = snapshot.agents[0]!.id;
    const node = { conversationId: 'child', parentConversationId: 'root', createdAt: 'a', updatedAt: 'b', status: 'running' as const };
    snapshot.subagentTrees = {
      [agentId]: { rootConversationId: 'root', nodes: { child: node }, operations: {}, activities: {} },
      'agent-deleted': { rootConversationId: 'gone', nodes: { child: node }, operations: {}, activities: {} },
    };

    const { roster } = splitPersistedState(persistedStateFromSnapshot(snapshot));

    expect(roster.subagents).toStrictEqual({ [agentId]: { rootConversationId: 'root', nodes: { child: node } } });
    expect(roundTrip(snapshot).subagentTrees).toStrictEqual({ [agentId]: { rootConversationId: 'root', nodes: { child: node }, operations: {}, activities: {} } });
  });

  it('restores repository visualizations in the order the user sees, not creation order', () => {
    const snapshot = createInitialSnapshot();
    const newer = visualization('newer', '2026-09-25T12:00:00.000Z');
    const older = visualization('older', '2026-09-21T12:00:00.000Z');
    snapshot.repositoryVisualizations = { '/repo': [newer, older] };

    const { visualizations } = splitPersistedState(persistedStateFromSnapshot(snapshot));

    expect(visualizations.map(({ repository, position, visualization: item }) => [repository, position, item.id])).toStrictEqual([['/repo', 0, 'newer'], ['/repo', 1, 'older']]);
    expect(roundTrip(snapshot).repositoryVisualizations).toStrictEqual({ '/repo': [newer, older] });
  });
});
