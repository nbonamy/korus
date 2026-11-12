import type { HarnessError } from '@korus-dev/multi-agent-sdk';
import type { BackendPublishedEvent, HarnessProvider } from '@workspace/core/contracts';

/** Conversation activity as the daemon publishes it, for tests that drive the daemon's own observers. */
type Scope = { provider?: HarnessProvider; conversationId?: string };
const envelope = (agentId: string, { provider = 'codex', conversationId }: Scope = {}) => ({ agentId, provider, seq: 0, occurredAt: '2026-11-11T00:00:00.000Z', ...(conversationId ? { conversationId } : {}) });

export const turnStarted = (agentId: string, turnId: string, scope?: Scope): BackendPublishedEvent =>
  ({ type: 'turn.started', ...envelope(agentId, scope), turnId, payload: {} });

export const turnCompleted = (agentId: string, turnId: string, scope: Scope & { status?: 'completed' | 'failed' | 'interrupted'; error?: HarnessError | null; willRetry?: boolean } = {}): BackendPublishedEvent =>
  ({ type: 'turn.completed', ...envelope(agentId, scope), turnId, payload: { status: scope.status ?? 'completed', error: scope.error ?? null, willRetry: scope.willRetry ?? false } });

export const sessionError = (agentId: string, error: HarnessError, scope: Scope & { turnId?: string; willRetry?: boolean } = {}): BackendPublishedEvent =>
  ({ type: 'session.error', ...envelope(agentId, scope), ...(scope.turnId ? { turnId: scope.turnId } : {}), payload: { error, willRetry: scope.willRetry ?? false } });

export const toolUpdated = (agentId: string, tool: { id: string; kind?: string; status: 'running' | 'completed' | 'failed' }, scope: Scope & { turnId?: string } = {}): BackendPublishedEvent =>
  ({ type: 'tool.updated', ...envelope(agentId, scope), ...(scope.turnId ? { turnId: scope.turnId } : {}), payload: { tool } });

export const turnOutput = (agentId: string, scope: Scope & { turnId?: string } = {}): BackendPublishedEvent =>
  ({ type: 'turn.output', ...envelope(agentId, scope), ...(scope.turnId ? { turnId: scope.turnId } : {}), payload: {} });

export const fileActivity = (agentId: string, activity: { path?: string; action: string; status: string }, scope: Scope & { turnId?: string } = {}): BackendPublishedEvent =>
  ({ type: 'file.activity', ...envelope(agentId, scope), ...(scope.turnId ? { turnId: scope.turnId } : {}), payload: activity });

export const diffUpdated = (agentId: string, scope: Scope & { turnId?: string } = {}): BackendPublishedEvent =>
  ({ type: 'diff.updated', ...envelope(agentId, scope), ...(scope.turnId ? { turnId: scope.turnId } : {}), payload: {} });
