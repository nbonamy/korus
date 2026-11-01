import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, ConversationSummary } from '@workspace/core/contracts';
import ConversationHistoryDialog from '../ConversationHistoryDialog.vue';

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
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ConversationHistoryDialog', () => {
  it('renders a compact filterable session list and resumes the selected session', async () => {
    const resumeConversation = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(ConversationHistoryDialog, {
      props: {
        agent,
        visible: true,
        listConversations: vi.fn().mockResolvedValue(sessions),
        resumeConversation,
      },
    });
    await flushPromises();

    expect(wrapper.get('.conversation-history-dialog').classes()).toContain('app-dialog--compact');
    expect(wrapper.find('.app-dialog__title').exists()).toBe(false);
    expect(wrapper.get('.el-dialog__header [aria-label="Filter sessions"]').attributes('placeholder')).toBe('Filter sessions');

    const rows = wrapper.findAll('.conversation-history-dialog__row');
    expect(rows.map((row) => row.text())).toStrictEqual(['Current workCurrent30m ago', 'Older workArchived1h ago']);
    expect(rows[0]!.attributes('disabled')).toBeDefined();

    await wrapper.get('[aria-label="Filter sessions"]').setValue('older');
    expect(wrapper.findAll('.conversation-history-dialog__row')).toHaveLength(1);
    await wrapper.get('.conversation-history-dialog__row').trigger('click');
    await flushPromises();

    expect(resumeConversation).toHaveBeenCalledWith('agent-dina', {
      ref: { backend: 'codex', threadId: 'thread-old' },
      storageState: 'archived',
    });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });
});
