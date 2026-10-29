export type WorktreeInitializationState = {
  state: 'running' | 'complete' | 'error';
  command?: string;
  error?: string;
};

export function isWorktreeInitializationState(value: unknown): value is WorktreeInitializationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['running', 'complete', 'error'].includes(record.state as string)
    && (record.command === undefined || typeof record.command === 'string')
    && (record.error === undefined || typeof record.error === 'string');
}
