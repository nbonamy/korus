import type { AgentBackend } from './contracts';
/** Live numeric observation only; no historical snapshots or inherited fork history. */
export type ExecutionObservation = { agentId: string; sessionId: string; turnId: string; provider: AgentBackend; phase: 'started' | 'completed' | 'failed' | 'interrupted'; at: number; model: string | null; tokens?: Consumption; durationMs?: number };
/** Input is uncached input; cacheRead/cacheWrite are separate input categories. Reasoning is a subset of output. */
export type Consumption = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number };
export type UsageRecord = ExecutionObservation & { startedAt: number; tokens?: Consumption; teamId: string | null; repository: string | null };
export type UsageFilter = { from?: string; to?: string; provider?: AgentBackend; model?: string; teamId?: string; repository?: string; agentId?: string; group?: 'provider' | 'model' | 'teamId' | 'repository' | 'agentId' };
export type UsageSummary = { recordedSince: number; retainedSince: number; rows: { label: string; started: number; completed: number; failed: number; interrupted: number; inProgress: number; measuredTurns: number; tokens: Consumption | null }[] };
export function validConsumption(value: unknown): value is Consumption {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string,unknown>;
  return Object.keys(record).every(key => ['input','output','cacheRead','cacheWrite','reasoning'].includes(key)) && ['input','output','cacheRead','cacheWrite'].every(key => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0 && (record[key] as number) <= 1e9) && (record.reasoning === undefined || Number.isSafeInteger(record.reasoning) && (record.reasoning as number) >= 0 && (record.reasoning as number) <= (record.output as number));
}
