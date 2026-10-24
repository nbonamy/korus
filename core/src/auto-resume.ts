import type { AgentBackend } from './contracts/shared';

export type RateLimitDetails = { resumeAt: number };
export type RateLimitPause = {
  backend: AgentBackend;
  conversationId: string;
  turnId?: string;
  detectedAt: number;
  resumeAt: number;
  enabled: boolean;
};
export function isRateLimitPause(value: unknown): value is RateLimitPause {
  if (!value || typeof value !== 'object') return false;
  const pause = value as RateLimitPause;
  return ['codex', 'claude', 'antigravity'].includes(pause.backend) && typeof pause.conversationId === 'string'
    && pause.conversationId.length > 0 && (pause.turnId === undefined || typeof pause.turnId === 'string')
    && Number.isFinite(pause.detectedAt) && Math.abs(pause.detectedAt) <= 8.64e15 && Number.isFinite(pause.resumeAt) && Math.abs(pause.resumeAt) <= 8.64e15 && typeof pause.enabled === 'boolean'
    && pause.resumeAt > pause.detectedAt;
}
