import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  formatVisualizationAnnotationPrompt,
  useVisualizationAnnotations,
  type VisualizationAnnotation,
} from '../use-visualization-annotations';

const annotation: VisualizationAnnotation = {
  id: 'visualization-annotation-1',
  visualizationId: 'visualization-7',
  title: 'Request flow',
  revision: 12,
  comment: 'Rename the selected services.',
  elements: [
    { id: 'service', type: 'rectangle', text: 'API service' },
    { id: 'database', type: 'rectangle', text: 'Database' },
  ],
};

describe('useVisualizationAnnotations', () => {
  it('formats the selected shape IDs, labels and revision as bounded agent context', () => {
    expect(formatVisualizationAnnotationPrompt([annotation], 'Rename these.')).toBe([
      '<context>',
      'Visualization annotations:',
      '',
      '1. Request flow',
      'Visualization ID: visualization-7',
      'Canvas revision when attached: 12',
      'Request: Rename the selected services.',
      'Selected elements:',
      '- service (rectangle): API service',
      '- database (rectangle): Database',
      '',
      'Read the referenced canvas elements by their stable IDs before editing. Preserve every unreferenced element and user edit.',
      '</context>',
      'Rename these.',
      '',
      '1 diagram annotation',
    ].join('\n'));
  });

  it('keeps multiple annotations for one diagram, removes one independently, and isolates agents', () => {
    const agentId = ref('agent-a');
    const annotations = useVisualizationAnnotations({ currentAgentId: () => agentId.value });
    annotations.add(annotation);
    annotations.add({ ...annotation, revision: 13, comment: 'Move the worker.', elements: [{ id: 'worker', type: 'rectangle' }] });
    expect(annotations.activeAnnotations.value).toMatchObject([
      { revision: 12, comment: 'Rename the selected services.' },
      { revision: 13, comment: 'Move the worker.', elements: [{ id: 'worker' }] },
    ]);
    annotations.remove(annotations.activeAnnotations.value[0]!.id);
    expect(annotations.activeAnnotations.value).toMatchObject([{ comment: 'Move the worker.' }]);
    agentId.value = 'agent-b';
    expect(annotations.activeAnnotations.value).toStrictEqual([]);
    agentId.value = 'agent-a';
    expect(annotations.activeAnnotations.value).toHaveLength(1);
  });

  it('attaches context to submission and clears it only after a successful send', async () => {
    const annotations = useVisualizationAnnotations({ currentAgentId: () => 'agent-a' });
    annotations.add(annotation);
    annotations.add({ ...annotation, revision: 13, comment: 'Move the worker.', elements: [{ id: 'worker', type: 'rectangle' }] });
    const failed = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(annotations.forward('', undefined, failed)).rejects.toThrow('offline');
    expect(annotations.activeAnnotations.value).toHaveLength(2);
    const send = vi.fn().mockResolvedValue(undefined);
    await annotations.forward('', { content: [] }, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining('Visualization annotations:'), { content: [{ type: 'text', text: '2 diagram annotations' }] });
    expect(send.mock.calls[0]![0]).toContain('Request: Rename the selected services.');
    expect(send.mock.calls[0]![0]).toContain('Request: Move the worker.');
    expect(send.mock.calls[0]![0]).toContain('2 diagram annotations');
    expect(annotations.activeAnnotations.value).toStrictEqual([]);
  });
});
