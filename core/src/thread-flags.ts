export const threadFlagIds = ['work_proposed', 'ready_for_review'] as const;

export type ThreadFlagId = typeof threadFlagIds[number];

/** Durable, predefined thread state authored by an agent and interpreted by App. */
export type ThreadFlags = Partial<Record<ThreadFlagId, true>>;

export type ProposedWorkAction = 'implement' | 'delegate' | 'create_mission' | 'dismiss';
export type ThreadFlagResponse =
  | { id: 'work_proposed'; action: ProposedWorkAction }
  | { id: 'ready_for_review'; action: 'execute' | 'dismiss' };

export function normalizeThreadFlags(flags: ThreadFlags): ThreadFlags {
  return {
    ...(flags.work_proposed ? { work_proposed: true } : {}),
    ...(flags.ready_for_review ? { ready_for_review: true } : {}),
  };
}

export function isThreadFlags(value: unknown): value is ThreadFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, enabled]) => (
    threadFlagIds.includes(id as ThreadFlagId) && enabled === true
  ));
}
