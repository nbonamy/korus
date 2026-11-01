import { effectScope, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, ConversationListInput, ConversationResumeTarget, ConversationSummary } from '@workspace/core/contracts';
import { relativeSessionDate, useSessionHistory } from '../use-session-history';

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  folder: '~/src/agent-workspace',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
  backendSession: { kind: 'codex', threadId: 'thread-current' },
  status: { type: 'idle' },
  createdAt: '2026-06-05T00:00:00.000Z',
  updatedAt: '2026-06-05T00:00:00.000Z',
};

const sessions: ConversationSummary[] = [
  {
    id: 'thread-current',
    title: 'Current work',
    updatedAt: '2026-06-10T09:30:00.000Z',
    messageCount: 12,
    storageState: 'active',
    ref: { backend: 'codex', threadId: 'thread-current' },
  },
  {
    id: 'thread-old',
    title: 'Older work',
    updatedAt: '2026-06-10T09:00:00.000Z',
    messageCount: 4,
    storageState: 'archived',
    ref: { backend: 'codex', threadId: 'thread-old' },
  },
  {
    id: 'thread-child',
    parentConversationId: 'thread-current',
    title: 'Scout',
    updatedAt: '2026-06-10T09:45:00.000Z',
    messageCount: 2,
    storageState: 'archived',
    ref: { backend: 'codex', threadId: 'thread-child' },
  },
];

const scopes: ReturnType<typeof effectScope>[] = [];

afterEach(() => {
  for (const scope of scopes) scope.stop();
  scopes.length = 0;
  vi.restoreAllMocks();
});

describe('useSessionHistory', () => {
  it('does not offer to resume the active Antigravity session or mistake another provider for it', async () => {
    const { agentRef, history } = createHistory();
    agentRef.value = { ...agent, backend: 'antigravity', backendSession: { kind: 'antigravity', sessionId: 'native-current' } };
    const current: ConversationSummary = { ...sessions[0]!, id: 'native-current', ref: { backend: 'antigravity', folder: agent.folder, sessionId: 'native-current' } };
    expect(history.isCurrentSession(current)).toBe(true);
    expect(history.canResume(current)).toBe(false);
    expect(history.isCurrentSession({ ...current, ref: { backend: 'claude', folder: agent.folder, sessionId: 'native-current' } })).toBe(false);
  });
  it('loads top-level sessions and filters them independently of the dialog', async () => {
    const listConversations = vi.fn().mockResolvedValue(sessions);
    const { history } = createHistory({ listConversations });
    await flushPromises();

    expect(listConversations).toHaveBeenCalledWith('agent-dina', { searchTerm: '', limit: 100 });
    expect(history.sessions.value.map((session) => session.id)).toStrictEqual(['thread-current', 'thread-old']);
    expect(history.isCurrentSession(sessions[0]!)).toBe(true);
    expect(history.canResume(sessions[0]!)).toBe(false);

    history.query.value = 'older';
    expect(history.filteredSessions.value.map((session) => session.id)).toStrictEqual(['thread-old']);
    expect(relativeSessionDate(
      '2026-06-10T09:30:00.000Z',
      Date.parse('2026-06-10T10:00:00.000Z'),
      translate,
    )).toBe('30m ago');
  });

  it('resumes only an idle agent session and reports failures', async () => {
    const resumeConversation = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Resume failed'));
    const { agentRef, history } = createHistory({ resumeConversation });
    await flushPromises();

    await expect(history.resume(sessions[1]!)).resolves.toBe(true);
    expect(resumeConversation).toHaveBeenCalledWith('agent-dina', {
      ref: { backend: 'codex', threadId: 'thread-old' },
      storageState: 'archived',
    });

    agentRef.value = { ...agentRef.value, status: { type: 'working' } };
    await expect(history.resume(sessions[1]!)).resolves.toBe(false);
    expect(resumeConversation).toHaveBeenCalledOnce();

    agentRef.value = { ...agentRef.value, status: { type: 'idle' } };
    await expect(history.resume(sessions[1]!)).resolves.toBe(false);
    expect(history.error.value).toBe('Resume failed');
  });

  it('surfaces listing errors without leaking stale sessions', async () => {
    const { history } = createHistory({
      listConversations: vi.fn().mockRejectedValue(new Error('List failed')),
    });
    await flushPromises();

    expect(history.sessions.value).toStrictEqual([]);
    expect(history.error.value).toBe('List failed');
    expect(history.loading.value).toBe(false);
  });
});

function createHistory(overrides: {
  listConversations?: (agentId: string, input?: ConversationListInput) => Promise<ConversationSummary[]>;
  resumeConversation?: (agentId: string, target: ConversationResumeTarget) => Promise<void>;
} = {}) {
  const agentRef = ref(agent);
  const visible = ref(true);
  const scope = effectScope();
  scopes.push(scope);
  const history = scope.run(() => useSessionHistory({
    agent: () => agentRef.value,
    visible: () => visible.value,
    listConversations: overrides.listConversations ?? vi.fn().mockResolvedValue(sessions),
    resumeConversation: overrides.resumeConversation ?? vi.fn().mockResolvedValue(undefined),
    translate,
  }))!;
  return { agentRef, history, visible };
}

function translate(key: string, params?: Record<string, number>): string {
  const messages: Record<string, string> = {
    'sessions.loadError': 'Unable to load sessions',
    'sessions.resumeError': 'Unable to resume session',
    'sessions.currentTitle': 'Current session',
    'sessions.untitled': 'Untitled session',
    'sessions.now': 'now',
    'sessions.minutesAgo': '{count}m ago',
    'sessions.hoursAgo': '{count}h ago',
    'sessions.daysAgo': '{count}d ago',
  };
  return (messages[key] ?? key).replace('{count}', String(params?.count ?? 0));
}
