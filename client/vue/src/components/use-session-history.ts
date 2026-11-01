import { computed, ref, watch } from 'vue';
import type { Agent, ConversationListInput, ConversationResumeTarget, ConversationSummary } from '@workspace/core/contracts';

type SessionTranslation = (key: string, params?: Record<string, number>) => string;

type SessionHistoryOptions = {
  agent: () => Agent;
  visible: () => boolean;
  listConversations: (agentId: string, input?: ConversationListInput) => Promise<ConversationSummary[]>;
  resumeConversation: (agentId: string, target: ConversationResumeTarget) => Promise<void>;
  translate: SessionTranslation;
};

export function useSessionHistory(options: SessionHistoryOptions) {
  const translate = options.translate;
  const sessions = ref<ConversationSummary[]>([]);
  const query = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const resumingSessionId = ref<string | null>(null);
  let requestId = 0;
  let queryTimer: ReturnType<typeof setTimeout> | null = null;

  const filteredSessions = computed(() => {
    const normalizedQuery = query.value.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sessions.value;
    return sessions.value.filter((session) => (
      `${sessionTitle(session)} ${session.id}`.toLocaleLowerCase().includes(normalizedQuery)
    ));
  });

  watch(
    [options.visible, () => options.agent().id, () => options.agent().folder],
    ([visible]) => {
      if (!visible) {
        requestId += 1;
        if (queryTimer) clearTimeout(queryTimer);
        return;
      }
      query.value = '';
      void refresh();
    },
    { immediate: true },
  );

  watch(query, () => {
    if (!options.visible()) return;
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => { void refresh(); }, 200);
  });

  async function refresh(): Promise<void> {
    const currentRequestId = requestId + 1;
    requestId = currentRequestId;
    sessions.value = [];
    loading.value = true;
    error.value = null;

    try {
      const nextSessions = await options.listConversations(options.agent().id, {
        searchTerm: query.value.trim(),
        limit: 100,
      });
      if (requestId === currentRequestId) {
        sessions.value = nextSessions.filter((session) => !session.parentConversationId);
      }
    } catch (caught) {
      if (requestId === currentRequestId) {
        error.value = caught instanceof Error ? caught.message : translate('sessions.loadError');
      }
    } finally {
      if (requestId === currentRequestId) loading.value = false;
    }
  }

  async function resume(session: ConversationSummary): Promise<boolean> {
    if (!canResume(session)) return false;
    resumingSessionId.value = session.id;
    error.value = null;
    try {
      await options.resumeConversation(options.agent().id, {
        ref: session.ref,
        storageState: session.storageState,
      });
      return true;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : translate('sessions.resumeError');
      return false;
    } finally {
      resumingSessionId.value = null;
    }
  }

  function canResume(session: ConversationSummary): boolean {
    return options.agent().status.type === 'idle' &&
      !isCurrentSession(session) &&
      resumingSessionId.value === null;
  }

  function isCurrentSession(session: ConversationSummary): boolean {
    const agent = options.agent();
    const backendSession = agent.backendSession;
    if (session.ref.backend === 'codex') {
      return backendSession?.kind === 'codex' && backendSession.threadId === session.ref.threadId;
    }

    return (backendSession?.kind === 'claude' || backendSession?.kind === 'antigravity') &&
      backendSession.kind === session.ref.backend &&
      session.ref.folder === agent.folder &&
      (backendSession.kind === 'claude' ? backendSession.transcriptSessionId ?? backendSession.sessionId : backendSession.sessionId) === session.ref.sessionId;
  }

  function sessionTitle(session: ConversationSummary): string {
    return session.title.trim() || (isCurrentSession(session)
      ? translate('sessions.currentTitle')
      : translate('sessions.untitled'));
  }

  return {
    canResume,
    error,
    filteredSessions,
    isCurrentSession,
    loading,
    query,
    refresh,
    resume,
    resumingSessionId,
    sessionTitle,
    sessions,
  };
}

export function relativeSessionDate(
  value: string,
  now = Date.now(),
  translate: SessionTranslation,
): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';

  const diffMs = now - timestamp;
  if (diffMs < 60_000) return translate('sessions.now');

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return translate('sessions.minutesAgo', { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate('sessions.hoursAgo', { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 7) return translate('sessions.daysAgo', { count: days });

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
