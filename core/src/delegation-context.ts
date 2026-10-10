export type DelegationOverrides = {
  startingContext: DelegationStartingContext;
  instructions?: string;
};

export type DelegationStartingContext = 'conversation' | 'handoff';

export function isDelegationOverrides(value: unknown): value is DelegationOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const overrides = value as Record<string, unknown>;
  return (overrides.startingContext === 'conversation' || overrides.startingContext === 'handoff')
    && (overrides.instructions === undefined || typeof overrides.instructions === 'string');
}

/** App-owned description of how a worktree assignment actually started. */
export type DelegationContext = {
  requested: DelegationStartingContext;
  effective: DelegationStartingContext;
  reason?: 'cross-provider' | 'unsupported' | 'unavailable';
};

export function isDelegationContext(value: unknown): value is DelegationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return (context.requested === 'conversation' || context.requested === 'handoff')
    && (context.effective === 'conversation' || context.effective === 'handoff')
    && (context.requested !== 'handoff' || context.effective === 'handoff')
    && (context.reason === undefined || (context.requested === 'conversation' && context.effective === 'handoff'))
    && (context.reason === undefined || ['cross-provider', 'unsupported', 'unavailable'].includes(context.reason as string));
}
