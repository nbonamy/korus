import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox } from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import type { VisualizationAsset, VisualizeSession } from '@workspace/core/visualize';
import VisualizePanel from '../VisualizePanel.vue';

vi.mock('../ExcalidrawCanvas.vue', () => ({ default: defineComponent({ props: ['visualization', 'imageSource'], template: '<div class="editor-canvas">{{ visualization.title }} canvas<img v-if="imageSource" :src="imageSource" /></div>' }) }));

function visualizeSession(): VisualizeSession {
  return {
    id: 'visualize-1',
    conversationRef: { backend: 'codex', threadId: 'thread-1' },
    isOpen: true,
    suggestions: [
      { id: 'suggestion-system', title: 'System map', description: 'Services, boundaries, and data flow.' },
      { id: 'suggestion-sequence', title: 'Request sequence', description: 'The critical request path.' },
    ],
    visualizations: [],
    selectedVisualizationId: null,
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
  };
}

describe('VisualizePanel', () => {
  it('directs an empty pane to the conversation choice without promising suggestion cards', () => {
    const visualize = visualizeSession();
    visualize.suggestions = [];
    const wrapper = mount(VisualizePanel, { props: { visualize, readAsset: vi.fn(), saveCanvas: vi.fn() } });
    expect(wrapper.get('.visualize-panel__intro').text()).toContain('Choose in the conversation');
    expect(wrapper.findAll('.visualize-panel__suggestion')).toHaveLength(0);
  });

  it('opens the canvas immediately without a separate Mermaid view', async () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{ id: 'map', title: 'Map', content: { kind: 'mermaid', source: 'flowchart LR; A --> B' }, createdAt: '', updatedAt: '' }];
    visualize.selectedVisualizationId = 'map';
    const wrapper = mount(VisualizePanel, {
      props: { visualize, readAsset: vi.fn(), saveCanvas: vi.fn() },
      global: { stubs: { ExcalidrawCanvas: defineComponent({
        props: ['visualization', 'sessionId', 'save'],
        template: `<div class="editor-canvas">{{ visualization.title }} canvas</div>`,
      }) } },
    });
    expect(wrapper.get('.editor-canvas').text()).toBe('Map canvas');
  });

  it('moves from suggestions to an inspectable visualization and switches with the thumbnail strip', async () => {
    const readAsset = vi.fn().mockResolvedValue({
      visualizationId: 'visualization-image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,ZGlhZ3JhbQ==',
    });
    const visualize = visualizeSession();
    const wrapper = mount(VisualizePanel, { props: { visualize, readAsset, saveCanvas: vi.fn() } });

    expect(wrapper.get('.visualize-panel__intro').text()).toContain('Choose a visualization to generate');
    expect(wrapper.findAll('.visualize-panel__suggestion')).toHaveLength(2);
    await wrapper.findAll('.visualize-panel__suggestion')[0].trigger('click');
    expect(wrapper.emitted('generate')).toStrictEqual([['suggestion-system']]);

    const generated: VisualizeSession = {
      ...visualize,
      suggestions: [{ ...visualize.suggestions[0], visualizationId: 'visualization-svg' }, visualize.suggestions[1]],
      visualizations: [{
        id: 'visualization-svg',
        title: 'System map',
        content: { kind: 'svg', source: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>' },
        createdAt: visualize.createdAt,
        updatedAt: visualize.updatedAt,
      }, {
        id: 'visualization-image',
        title: 'Concept image',
        content: { kind: 'image', assetPath: 'concept.png', mimeType: 'image/png', alt: 'Concept visualization' },
        createdAt: visualize.createdAt,
        updatedAt: visualize.updatedAt,
      }],
      selectedVisualizationId: 'visualization-svg',
    };
    await wrapper.setProps({ visualize: generated });
    await flushPromises();

    expect(wrapper.get('.visualize-panel__heading').text()).toContain('System map');
    expect(wrapper.text()).not.toContain('Also suggested');
    expect(wrapper.text()).not.toContain('Ask in chat to edit this visualization or add another.');
    expect(wrapper.findAll('.visualize-panel__thumbnail')).toHaveLength(2);
    expect(readAsset).toHaveBeenCalledWith('visualization-image');
    await wrapper.findAll('.visualize-panel__thumbnail')[1].trigger('click');
    expect(wrapper.emitted('select')).toStrictEqual([['visualization-image']]);
  });

  it('keeps legacy long suggestion descriptions compact while preserving the full text on hover', () => {
    const visualize = visualizeSession();
    const description = `Map ${'every relevant system boundary '.repeat(12)}`.trim();
    visualize.suggestions[0].description = description;
    const wrapper = mount(VisualizePanel, { props: { saveCanvas: vi.fn(), visualize, readAsset: vi.fn() } });
    const rendered = wrapper.findAll('.visualize-panel__suggestion p')[0];

    expect(rendered.text()).toHaveLength(118);
    expect(rendered.text()).toMatch(/…$/u);
    expect(rendered.attributes('title')).toBe(description);
  });

  it('keeps the newest image when an older asset request resolves last', async () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{
      id: 'visualization-image',
      title: 'Concept image',
      content: { kind: 'image', assetPath: 'concept.png', mimeType: 'image/png', alt: 'Concept visualization' },
      createdAt: visualize.createdAt,
      updatedAt: '2026-09-21T12:00:01.000Z',
    }];
    visualize.selectedVisualizationId = 'visualization-image';
    let resolveOld!: (asset: VisualizationAsset) => void;
    let resolveNew!: (asset: VisualizationAsset) => void;
    const oldAsset = new Promise<VisualizationAsset>(resolve => { resolveOld = resolve; });
    const newAsset = new Promise<VisualizationAsset>(resolve => { resolveNew = resolve; });
    const readAsset = vi.fn()
      .mockReturnValueOnce(oldAsset)
      .mockReturnValueOnce(newAsset);
    const wrapper = mount(VisualizePanel, { props: { visualize, readAsset, saveCanvas: vi.fn() } });

    await wrapper.setProps({
      visualize: {
        ...visualize,
        visualizations: [{
          ...visualize.visualizations[0],
          content: { kind: 'image', assetPath: 'concept-new.png', mimeType: 'image/png', alt: 'Updated concept' },
        }],
      },
    });
    resolveNew({ visualizationId: 'visualization-image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,new' });
    await flushPromises();
    expect(wrapper.get('.visualize-panel__diagram img').attributes('src')).toBe('data:image/png;base64,new');

    resolveOld({ visualizationId: 'visualization-image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,old' });
    await flushPromises();
    expect(wrapper.get('.visualize-panel__diagram img').attributes('src')).toBe('data:image/png;base64,new');
  });

  it('drops a deleted image from the cache before the same id is added again', async () => {
    const visualize = visualizeSession();
    const image = {
      id: 'visualization-image',
      title: 'Concept image',
      content: { kind: 'image' as const, assetPath: 'concept.png', mimeType: 'image/png' as const, alt: 'Concept visualization' },
      createdAt: visualize.createdAt,
      updatedAt: visualize.updatedAt,
    };
    visualize.visualizations = [image];
    visualize.selectedVisualizationId = image.id;
    const readAsset = vi.fn()
      .mockResolvedValueOnce({ visualizationId: image.id, mimeType: 'image/png', dataUrl: 'data:image/png;base64,old' })
      .mockResolvedValueOnce({ visualizationId: image.id, mimeType: 'image/png', dataUrl: 'data:image/png;base64,new' });
    const wrapper = mount(VisualizePanel, { props: { visualize, readAsset, saveCanvas: vi.fn() } });
    await flushPromises();

    await wrapper.setProps({ visualize: { ...visualize, visualizations: [], selectedVisualizationId: null } });
    await wrapper.setProps({ visualize: { ...visualize, visualizations: [{ ...image, content: { ...image.content, assetPath: 'concept-new.png' } }] } });
    await flushPromises();

    expect(readAsset).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.visualize-panel__diagram img').attributes('src')).toBe('data:image/png;base64,new');
  });

  it('shows an error when a generated image asset cannot be read', async () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{
      id: 'visualization-image',
      title: 'Missing image',
      content: { kind: 'image', assetPath: 'missing.png', mimeType: 'image/png', alt: 'Missing visualization' },
      createdAt: visualize.createdAt,
      updatedAt: visualize.updatedAt,
    }];
    visualize.selectedVisualizationId = 'visualization-image';
    const wrapper = mount(VisualizePanel, {
      props: { saveCanvas: vi.fn(), visualize, readAsset: vi.fn().mockRejectedValue(new Error('missing')) },
    });

    await flushPromises();

    expect(wrapper.get('.visualize-panel__diagram [role="alert"]').text()).toBe('Could not load this image.');
    expect(wrapper.get('.visualize-panel__diagram').text()).not.toContain('Loading');
  });

  it('sanitizes unsafe SVG before displaying it as an image', () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{
      id: 'visualization-svg',
      title: 'Untrusted SVG',
      content: {
        kind: 'svg',
        source: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          '<style>.safe{fill:url(#gradient)}.unsafe{fill:url(https://example.com/pattern)}</style>',
          '<defs><linearGradient id="gradient"/><marker id="arrowhead"/></defs>',
          '<script>alert(1)</script>',
          '<a href="https://example.com"><rect onload="alert(2)" width="20" height="20"/></a>',
          '<path class="safe" marker-end="url(#arrowhead)" d="M0 0L20 20"/>',
          '</svg>',
        ].join(''),
      },
      createdAt: visualize.createdAt,
      updatedAt: visualize.updatedAt,
    }];
    visualize.selectedVisualizationId = 'visualization-svg';
    const wrapper = mount(VisualizePanel, {
      props: { saveCanvas: vi.fn(), visualize, readAsset: vi.fn() },
    });
    const source = decodeURIComponent(wrapper.get('.visualize-panel__thumbnail img').attributes('src') ?? '');

    expect(source).not.toContain('<script');
    expect(source).not.toContain('onload');
    expect(source).not.toContain('https://example.com');
    expect(source).toContain('fill:url(#gradient)');
    expect(source).toContain('marker-end="url(#arrowhead)"');
  });

  it('confirms thumbnail deletion before emitting the visualization id', async () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{
      id: 'visualization-system',
      title: 'System map',
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
      createdAt: visualize.createdAt,
      updatedAt: visualize.updatedAt,
    }];
    visualize.selectedVisualizationId = 'visualization-system';
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(VisualizePanel, { props: { saveCanvas: vi.fn(), visualize, readAsset: vi.fn() } });

    await wrapper.get('button[aria-label="Delete System map"]').trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      '“System map” will be removed from this conversation.',
      'Delete diagram?',
      expect.objectContaining({ confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }),
    );
    expect(wrapper.emitted('delete')).toStrictEqual([['visualization-system']]);

    confirm.mockRejectedValueOnce(new Error('cancelled'));
    await wrapper.get('button[aria-label="Delete System map"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('delete')).toStrictEqual([['visualization-system']]);
    confirm.mockRestore();
  });

  it('allows thumbnail deletion while the agent is working', async () => {
    const visualize = visualizeSession();
    visualize.visualizations = [{
      id: 'visualization-system',
      title: 'System map',
      content: { kind: 'mermaid', source: 'flowchart LR\n A --> B' },
      createdAt: visualize.createdAt,
      updatedAt: visualize.updatedAt,
    }];
    visualize.selectedVisualizationId = 'visualization-system';
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(VisualizePanel, { props: { busy: true, saveCanvas: vi.fn(), visualize, readAsset: vi.fn() } });

    const remove = wrapper.get('button[aria-label="Delete System map"]');
    expect(remove.attributes('disabled')).toBeUndefined();
    await remove.trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledOnce();
    expect(wrapper.emitted('delete')).toStrictEqual([['visualization-system']]);
    confirm.mockRestore();
  });
});
