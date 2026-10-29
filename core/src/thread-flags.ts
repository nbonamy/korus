export const threadFlagIds = ['work_proposed', 'delegate_to_worktree', 'ready_for_review'] as const;

export type ThreadFlagId = typeof threadFlagIds[number];
export type CanonicalThreadFlagId = Exclude<ThreadFlagId, 'delegate_to_worktree'>;

/** Durable, predefined thread state authored by an agent and interpreted by App. */
export type ThreadFlags = Partial<Record<ThreadFlagId, true>>;

export type ProposedWorkAction = 'delegate' | 'create_mission' | 'dismiss';
export type ThreadFlagResponse =
  | { id: 'work_proposed'; action: ProposedWorkAction }
  | { id: 'delegate_to_worktree'; action: ProposedWorkAction | 'execute' }
  | { id: 'ready_for_review'; action: 'execute' | 'dismiss' };

export function normalizeThreadFlagId(id: ThreadFlagId): CanonicalThreadFlagId {
  return id === 'delegate_to_worktree' ? 'work_proposed' : id;
}

export function normalizeThreadFlags(flags: ThreadFlags): Partial<Record<CanonicalThreadFlagId, true>> {
  return {
    ...(flags.work_proposed || flags.delegate_to_worktree ? { work_proposed: true } : {}),
    ...(flags.ready_for_review ? { ready_for_review: true } : {}),
  };
}

export function isThreadFlags(value: unknown): value is ThreadFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, enabled]) => (
    threadFlagIds.includes(id as ThreadFlagId) && enabled === true
  ));
}
