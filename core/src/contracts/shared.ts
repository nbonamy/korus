export type AppTextDescriptor = {
  key: string;
  params?: Record<string, string | number>;
};

export type AppText = string | AppTextDescriptor;

export const agentBackends = ['codex', 'claude', 'cursor', 'antigravity'] as const;
export type AgentBackend = typeof agentBackends[number];

export function isAgentBackend(value: unknown): value is AgentBackend {
  return agentBackends.includes(value as AgentBackend);
}

export type ApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type ReasoningEffort = string;
