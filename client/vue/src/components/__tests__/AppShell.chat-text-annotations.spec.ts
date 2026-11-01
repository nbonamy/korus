import type { CodexMessageTextSelection } from '@codex-app-sdk/vue';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import {
  conversationControllerActions,
  mountShell,
} from './app-shell-test-harness';

const selection: CodexMessageTextSelection = {
  text: 'The request should be retried.',
  messageId: 'message-2',
  turnId: 'turn-1',
  messageIndex: 1,
  role: 'assistant',
  anchor: { x: 80, y: 120, width: 160, height: 20 },
};

describe('AppShell chat text annotations', () => {
  it('saves selection comments, preserves them across agents, and submits annotation-only context', async () => {
    const snapshot = createInitialSnapshot();
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, realConversationPane: true, sendPromptAction });

    await saveSelectionComment(wrapper, selection, 'Add a bounded retry.');
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');
    expect(wrapper.text()).not.toContain('Add a bounded retry.');

    await wrapper.setProps({ activeAgent: snapshot.agents[1] } as Record<string, unknown>);
    expect(wrapper.getComponent({ name: 'AgentWorkspace' }).props('currentAgent')).toMatchObject({
      id: snapshot.agents[1]!.id,
    });
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
    await wrapper.setProps({ activeAgent: snapshot.agents[0] } as Record<string, unknown>);
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');

    await conversationControllerActions(wrapper).submit?.('', undefined);
    expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith([
      '<context>',
      'Chat annotations:',
      '',
      '1. Assistant message 2',
      'Selected text:',
      '> The request should be retried.',
      'Comment: Add a bounded retry.',
      '</context>',
      '1 annotation',
    ].join('\n'), undefined);
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
  });

  it('keeps the annotation when prompt submission fails', async () => {
    const sendPromptAction = vi.fn().mockRejectedValue(new Error('offline'));
    const wrapper = mountShell({ realConversationPane: true, sendPromptAction });
    await saveSelectionComment(wrapper, selection, 'Keep this until it sends.');

    await expect(conversationControllerActions(wrapper).submit?.('Please update this.', undefined))
      .rejects.toThrow('offline');
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');
  });
});

async function saveSelectionComment(
  wrapper: ReturnType<typeof mountShell>,
  nextSelection: CodexMessageTextSelection,
  comment: string,
): Promise<void> {
  wrapper.getComponent({ name: 'CodexConversationPane' }).vm
    .$emit('messageTextSelectionChange', nextSelection);
  await nextTick();
  await wrapper.get('.chat-text-selection-annotation__add').trigger('click');
  const input = document.querySelector<HTMLInputElement>('.annotation-popup__input');
  const form = document.querySelector<HTMLFormElement>('form.annotation-popup');
  if (!input || !form) throw new Error('Annotation popup was not rendered.');
  input.value = comment;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
}
