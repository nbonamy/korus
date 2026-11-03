import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import GitDiffVizMermaid from '../GitDiffVizMermaid.vue';

const diagram = { format: 'mermaid' as const, source: 'flowchart TB\nsubgraph system[System]\nA["Sync service"]\nB["Storage"]\nA -->|stores| B\nend', nodes: [
  { id: 'A', label: 'Sync service', status: 'changed' as const, paths: ['src/sync.ts', 'src/store.ts'] },
  { id: 'B', label: 'Storage', status: 'unchanged' as const, paths: [] },
  { id: 'missing', label: 'Unmatched optional annotation', status: 'changed' as const, paths: [] },
] };
it('keeps simultaneous Fast diagrams isolated and opens only changed semantic nodes with pointer or keyboard', async () => {
  const wrapper = mount({ components: { GitDiffVizMermaid }, setup: () => ({ diagram }), template: '<div><GitDiffVizMermaid :diagram="diagram"/><GitDiffVizMermaid :diagram="diagram"/></div>' });
  try {
    const ids = wrapper.findAll('[id]').map(element => element.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    const first = wrapper.findAllComponents(GitDiffVizMermaid)[0]!;
    const changed = first.get('g.node[data-id="A"]');
    expect(changed.attributes('role')).toBe('button');
    expect(first.get('g.node[data-id="B"]').attributes('role')).toBeUndefined();
    await changed.trigger('click');
    await changed.trigger('keydown', { key: 'Enter' });
    await first.get('g.node[data-id="B"]').trigger('click');
    expect(first.emitted('select')).toStrictEqual([[diagram.nodes[0]!.paths], [diagram.nodes[0]!.paths]]);
    for (const svg of wrapper.findAll('.diff-viz-mermaid__stage svg')) {
      const rootId = svg.attributes('id');
      expect(svg.get('style').text()).toContain(`#${rootId}`);
    }
  } finally { wrapper.unmount(); }
});
