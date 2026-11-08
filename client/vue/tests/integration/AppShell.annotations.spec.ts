import type { CodexMessageTextSelection } from '@codex-app-sdk/vue';
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

const selection: CodexMessageTextSelection = {
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
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');
    expect(wrapper.text()).not.toContain('Add a bounded retry.');

    await wrapper.setProps({ activeAgent: snapshot.agents[1] } as Record<string, unknown>);
    expect(wrapper.getComponent({ name: 'AgentWorkspace' }).props('currentAgent')).toMatchObject({
      id: snapshot.agents[1]!.id,
    });
    expect(wrapper.find('.composer-context-cards').exists()).toBe(false);
    await wrapper.setProps({ activeAgent: snapshot.agents[0] } as Record<string, unknown>);
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');

    sendPromptAction.mockRejectedValueOnce(new Error('offline'));
    await expect(conversationControllerActions(wrapper).submit?.('Please update this.', undefined))
      .rejects.toThrow('offline');
    expect(wrapper.get('.composer-context-cards__card').text()).toBe('Annotation');
    sendPromptAction.mockClear();

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
