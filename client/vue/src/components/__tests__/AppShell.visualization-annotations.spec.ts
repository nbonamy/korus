import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { conversationControllerActions, mountShell } from './app-shell-test-harness';
import type { VisualizationAnnotationInput } from '../use-visualization-annotations';

const annotation: VisualizationAnnotationInput = {
  visualizationId: 'visualization-7',
  title: 'Request flow',
  revision: 12,
  comment: 'Rename this service.',
  elements: [{ id: 'service', type: 'rectangle', text: 'API service' }],
};

describe('AppShell visualization annotations', () => {
  it('moves a canvas selection into composer context and submits it through the active agent', async () => {
    const snapshot = createInitialSnapshot();
    const sendPromptAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountShell({ snapshot, realConversationPane: true, sendPromptAction });

    const panel = wrapper.getComponent({ name: 'RightWorkspacePanel' });
    panel.vm.$emit('annotateVisualization', annotation);
    panel.vm.$emit('annotateVisualization', { ...annotation, revision: 13, comment: 'Make the database blue.', elements: [{ id: 'database', type: 'rectangle', text: 'Database' }] });
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
});
