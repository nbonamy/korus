import type { MessageTextSelection } from '@korus-dev/agent-ui-sdk';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { conversationControllerActions, mountShell } from '../support/app-shell-test-harness';
import type { CodeAnnotationInput } from '../../src/components/use-code-annotations';
import type { VisualizationAnnotationInput } from '../../src/components/use-visualization-annotations';

const codeAnnotation: CodeAnnotationInput = { path: 'src/billing.ts', startLine: 12, endLine: 14, side: 'new', text: '+const total = sum(items);\n+return total;', comment: 'Guard the empty cart.' };

const visualizationAnnotation: VisualizationAnnotationInput = {
  visualizationId: 'visualization-7',
  title: 'Request flow',
  revision: 12,
  comment: 'Rename this service.',
  elements: [{ id: 'service', type: 'rectangle', text: 'API service' }],
};

const selection: MessageTextSelection = {
  text: 'The request should be retried.',
  messageId: 'message-2',
  turnId: 'turn-1',
  messageIndex: 1,
  role: 'assistant',
  anchor: { x: 80, y: 120, width: 160, height: 20 },
};

describe('AppShell composer annotations', () => {
  it('removes draft code comments and sends code and canvas selections through the composer', async () => {
    const snapshot = createInitialSnapshot();
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, realConversationPane: true, sendPromptAction });

    const panel = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    panel.vm.$emit('annotateCode', codeAnnotation);
    await flushPromises();
    await wrapper.get('.composer-context-cards__remove').trigger('click');
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);

    panel.vm.$emit('annotateCode', codeAnnotation);
    panel.vm.$emit('annotateCode', { path: 'src/cart.ts', startLine: 3, endLine: 3, text: 'let x;', comment: 'Name this.' });
    await flushPromises();
    expect(wrapper.findAll('.composer-context-cards__card')).toHaveLength(2);
    expect(wrapper.findAll('.composer-context-cards__label').map(label => label.text())).toEqual(['Code', 'Code']);
    expect(wrapper.findAll('.composer-context-cards__card').map(card => card.attributes('title'))).toEqual(['Guard the empty cart.', 'Name this.']);
    expect(wrapper.text()).toContain('billing.ts:12-14');
    expect(wrapper.text()).toContain('cart.ts:3');

    await conversationControllerActions(wrapper).submit?.('Fix them.', undefined);
    const prompt = String(sendPromptAction.mock.calls[0]?.[0]);
    expect(prompt).toContain('Code annotations:');
    expect(prompt).toContain('1. src/billing.ts lines 12-14');
    expect(prompt).toContain('> +const total = sum(items);');
    expect(prompt).toContain('Comment: Guard the empty cart.');
    expect(prompt).toContain('2. src/cart.ts line 3');
    expect(prompt).toContain('Fix them.');
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);

    sendPromptAction.mockClear();
    panel.vm.$emit('annotateVisualization', visualizationAnnotation);
    panel.vm.$emit('annotateVisualization', { ...visualizationAnnotation, revision: 13, comment: 'Make the database blue.', elements: [{ id: 'database', type: 'rectangle', text: 'Database' }] });
    await flushPromises();
    expect(wrapper.findAll('.composer-context-cards__card')).toHaveLength(2);
    expect(wrapper.findAll('.composer-context-cards__label').map(label => label.text())).toEqual(['Annotation', 'Annotation']);
    expect(wrapper.findAll('.composer-context-cards__card').map(card => card.attributes('title'))).toEqual(['Rename this service.', 'Make the database blue.']);

    await conversationControllerActions(wrapper).submit?.('Rename it.', undefined);
    expect(sendPromptAction).toHaveBeenCalledWith(expect.stringContaining('Visualization annotations:'), undefined);
    const submittedPrompt = String(sendPromptAction.mock.calls[0]?.[0]);
    expect(submittedPrompt).toContain('Visualization ID: visualization-7');
    expect(submittedPrompt).toContain('Request: Rename this service.');
    expect(submittedPrompt).toContain('Request: Make the database blue.');
    expect(submittedPrompt).toContain('- service (rectangle): API service');
    expect(submittedPrompt).toContain('- database (rectangle): Database');
    expect(submittedPrompt).toContain('Rename it.');
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
  });

  it('keeps selected chat comments scoped to their agent through failure and retry, then clears them after sending', async () => {
    const snapshot = createInitialSnapshot();
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, realConversationPane: true, sendPromptAction });

    await saveSelectionComment(wrapper, selection, 'Add a bounded retry.');
    expect(wrapper.findAll('.chat-annotation-review .composer-context-cards__open')).toHaveLength(1);
    expect(wrapper.get('.chat-annotation-review .composer-context-cards__open').text()).toBe('Add a bounded retry.');
    expect(wrapper.get('.chat-annotation-review').text()).toContain('Add a bounded retry.');
    await wrapper.get('.chat-annotation-review .composer-context-cards__open').trigger('click');
    await flushPromises();
    expect(wrapper.find('.chat-annotation-editor').exists()).toBe(false);
    await wrapper.get('.chat-annotation-review .composer-context-cards__edit').trigger('click');
    await flushPromises();
    expect(wrapper.get('.chat-annotation-editor blockquote').text()).toBe(selection.text);
    const editInput = wrapper.get<HTMLInputElement>('.chat-annotation-editor input');
    expect(editInput.element.value).toBe('Add a bounded retry.');
    await editInput.setValue('Use three attempts.');
    await wrapper.get('.chat-annotation-editor__save').trigger('click');
    await flushPromises();
    expect(wrapper.get('.chat-annotation-review').text()).toContain('Use three attempts.');

    await wrapper.setProps({ activeAgent: snapshot.agents[1] } as Record<string, unknown>);
    expect(wrapper.getComponent({ name: 'AgentWorkspace' }).props('currentAgent')).toMatchObject({
      id: snapshot.agents[1]!.id,
    });
    expect(wrapper.find('.chat-annotation-review').exists()).toBe(false);
    await wrapper.setProps({ activeAgent: snapshot.agents[0] } as Record<string, unknown>);
    expect(wrapper.findAll('.chat-annotation-review .composer-context-cards__open')).toHaveLength(1);

    sendPromptAction.mockRejectedValueOnce(new Error('offline'));
    await expect(conversationControllerActions(wrapper).submit?.('Please update this.', undefined))
      .rejects.toThrow('offline');
    expect(wrapper.findAll('.chat-annotation-review .composer-context-cards__open')).toHaveLength(1);
    sendPromptAction.mockClear();

    await conversationControllerActions(wrapper).submit?.('', undefined);
    expect(sendPromptAction).toHaveBeenCalledExactlyOnceWith([
      '<context>',
      'Chat annotations:',
      '',
      '1. Assistant message 2',
      'Selected text:',
      '> The request should be retried.',
      'Comment: Use three attempts.',
      '</context>',
      '1 annotation',
    ].join('\n'), undefined);
    expect(wrapper.find('.chat-annotation-review').exists()).toBe(false);
  });
});

async function saveSelectionComment(
  wrapper: ReturnType<typeof mountShell>,
  nextSelection: MessageTextSelection,
  comment: string,
): Promise<void> {
  const block = document.createElement('div');
  block.dataset.chatAnnotationMessage = nextSelection.messageId ?? String(nextSelection.messageIndex);
  const content = document.createElement('div');
  content.dataset.chatAnnotationContent = '';
  content.textContent = nextSelection.text;
  block.append(content);
  const host = document.createElement('div');
  host.className = 'conversation-pane';
  host.append(block);
  document.body.append(host);
  const range = document.createRange();
  range.selectNodeContents(content);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  wrapper.getComponent({ name: 'ConversationPane' }).vm
    .$emit('messageTextSelectionChange', nextSelection);
  await nextTick();
  host.remove();
  await wrapper.get('.chat-text-selection-annotation__add').trigger('click');
  const input = document.querySelector<HTMLInputElement>('.annotation-popup__input');
  const form = document.querySelector<HTMLFormElement>('form.annotation-popup');
  if (!input || !form) throw new Error('Annotation popup was not rendered.');
  input.value = comment;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flushPromises();
}
