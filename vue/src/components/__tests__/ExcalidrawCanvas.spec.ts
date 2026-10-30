import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasDocument, SaveCanvasInput } from '@workspace/core/visualize-canvas';
import type { Visualization } from '@workspace/core/visualize';
import type { CanvasScene } from '../excalidraw-editor';
import ExcalidrawCanvas from '../ExcalidrawCanvas.vue';
const editor = vi.hoisted(() => ({
  importScene: vi.fn(),
  setSelection: vi.fn(),
  getAnnotationTargets: vi.fn(() => [{ id: 'b', x: 190, y: 20, width: 120, height: 110 }]),
  update: vi.fn(),
  fit: vi.fn(),
  zoomBy: vi.fn(),
  getControlsState: vi.fn(() => ({ zoom: 1 })),
  dispose: vi.fn(),
  preview: vi.fn().mockResolvedValue('data:image/png;base64,YQ=='),
  change: (_scene: CanvasScene) => {},
}));
vi.mock('../excalidraw-editor', () => ({
  importVisualization: (...args: unknown[]) => editor.importScene(...args),
  mountCanvas: (_host: HTMLElement, _scene: CanvasScene, change: typeof editor.change) => { editor.change = change; return editor; },
}));
const canvas: CanvasDocument = {
  revision: 1, elements: [{ id: 'a', type: 'text', text: 'User label', x: 20, y: 30, width: 100, height: 24 }, { id: 'b', type: 'rectangle', x: 200, y: 30, width: 100, height: 90 }],
  selectedElementIds: ['a'], files: {}, preview: '',
};
const visualization: Visualization = { id: 'v', title: 'Map', content: { kind: 'mermaid', source: 'flowchart LR; A --> B' }, canvas, createdAt: '', updatedAt: '' };
beforeEach(() => {
  vi.clearAllMocks();
  editor.importScene.mockReset().mockImplementation(async (value: Visualization) => structuredClone(value.canvas));
  editor.getControlsState.mockReturnValue({ zoom: 1 });
  editor.getAnnotationTargets.mockReturnValue([{ id: 'b', x: 190, y: 20, width: 120, height: 110 }]);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });
describe('ExcalidrawCanvas', () => {
  it('retries failed diagram imports instead of leaving the canvas loading', async () => {
    editor.importScene.mockRejectedValueOnce(new Error('The visualization did not produce valid SVG.'))
      .mockRejectedValueOnce(new Error('Import still unavailable.')).mockResolvedValue(structuredClone(canvas));
    const save = vi.fn(async () => canvas);
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization: { ...visualization, canvas: undefined }, save, sessionId: 'session' } });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('valid SVG');
    await wrapper.get('.visualize-editor__status button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('Import still unavailable.');
    await wrapper.get('.visualize-editor__status button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.visualize-editor__status').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="Fit canvas"]').attributes('disabled')).toBeUndefined();
    expect(editor.importScene).toHaveBeenCalledTimes(3);
  });
  it('autosaves the selected shapes for the original agent without a second composer', async () => {
    const save = vi.fn(async (input: SaveCanvasInput) => ({ ...input.document, revision: input.expectedRevision + 1 })).mockRejectedValueOnce(new Error('Save unavailable.'));
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save, sessionId: 'session' } });
    await flushPromises();
    const selected = structuredClone(canvas);
    selected.selectedElementIds = ['b'];
    editor.change(selected);
    await vi.advanceTimersByTimeAsync(200);
    await wrapper.get('.visualize-editor__status button').trigger('click');
    await flushPromises();
    expect(editor.importScene).toHaveBeenCalledTimes(1);
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(save).toHaveBeenCalledWith({ sessionId: 'session', expectedSource: JSON.stringify(visualization.content), visualizationId: 'v', expectedRevision: 1, document: { ...selected, preview: 'data:image/png;base64,YQ==' } });

  });
  it('starts in pan mode and toggles annotation selection without exposing edit mode', async () => {
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save: vi.fn(), sessionId: 'session' } });
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Edit"]').exists()).toBe(false);
    const toggle = wrapper.get('button[aria-label="Annotate diagram"]');
    await wrapper.get('button[aria-label="Fit canvas"]').trigger('click');
    expect(editor.fit).toHaveBeenCalledOnce();
    expect(toggle.attributes('aria-pressed')).toBe('false');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-label')).toBe('Stop annotating');
    const target = wrapper.get('button[aria-label="Select shape b"]');
    expect(target.attributes('aria-pressed')).toBe('false');
    await target.trigger('click');
    expect(editor.setSelection).toHaveBeenLastCalledWith(['b']);
    expect(target.attributes('aria-pressed')).toBe('true');
    expect(wrapper.findComponent({ name: 'AnnotationPopup' }).exists()).toBe(true);
    expect(wrapper.emitted('annotate')).toBeUndefined();
    await toggle.trigger('click');
    expect(editor.dispose).not.toHaveBeenCalled();
  });
  it('keeps the canvas height stable while an annotation selection autosaves', async () => {
    const scene = { ...canvas, selectedElementIds: [] };
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization: { ...visualization, canvas: scene }, save: vi.fn(), sessionId: 'session' } });
    await flushPromises();
    await wrapper.get('button[aria-label="Annotate diagram"]').trigger('click');
    await wrapper.get('button[aria-label="Select shape b"]').trigger('click');

    expect(wrapper.get('button[aria-label="Select shape b"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.visualize-editor__status').exists()).toBe(false);
  });
  it('replaces the annotated shape when another box is clicked', async () => {
    editor.getAnnotationTargets.mockReturnValue([
      { id: 'b', x: 190, y: 20, width: 120, height: 110 },
      { id: 'c', x: 350, y: 20, width: 120, height: 110 },
    ]);
    const scene = { ...canvas, selectedElementIds: [], elements: [...canvas.elements, { id: 'c', type: 'rectangle', x: 350, y: 30, width: 100, height: 90 }] };
    const save = vi.fn(async (input: SaveCanvasInput) => ({ ...input.document, revision: input.expectedRevision + 1 }));
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization: { ...visualization, canvas: scene }, save, sessionId: 'session' } });
    await flushPromises();
    await wrapper.get('button[aria-label="Annotate diagram"]').trigger('click');
    await wrapper.get('button[aria-label="Select shape b"]').trigger('click');
    await wrapper.get('button[aria-label="Select shape c"]').trigger('click');

    expect(wrapper.get('button[aria-label="Select shape b"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('button[aria-label="Select shape c"]').attributes('aria-pressed')).toBe('true');
    wrapper.getComponent({ name: 'AnnotationPopup' }).vm.$emit('submit', 'Change C');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(wrapper.emitted('annotate')?.[0]?.[0]).toMatchObject({ elements: [{ id: 'c', type: 'rectangle' }] });
    expect(save.mock.calls.at(-1)?.[0].document.selectedElementIds).toEqual([]);
    await wrapper.get('button[aria-label="Select shape c"]').trigger('click');
    await wrapper.get('button[aria-label="Select shape c"]').trigger('click');
    expect(wrapper.get('button[aria-label="Select shape c"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.findComponent({ name: 'AnnotationPopup' }).exists()).toBe(false);
  });
  it('keeps zoom usable without Excalidraw toolbar controls', async () => {
    editor.getControlsState.mockReturnValue({ zoom: 0.4 });
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save: vi.fn(), sessionId: 'session' } });
    await flushPromises();
    expect(wrapper.get('.visualize-editor__compact-zoom').text()).toContain('40%');
    await wrapper.get('button[aria-label="Zoom out"]').trigger('click');
    await wrapper.get('button[aria-label="Zoom in"]').trigger('click');
    expect(editor.zoomBy).toHaveBeenNthCalledWith(1, -0.1);
    expect(editor.zoomBy).toHaveBeenNthCalledWith(2, 0.1);
  });
  it('accepts repeated annotations while clearing each validated selection', async () => {
    const save = vi.fn(async (input: SaveCanvasInput) => ({ ...input.document, revision: input.expectedRevision + 1 }));
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save, sessionId: 'session' } });
    await flushPromises();
    await wrapper.get('button[aria-label="Annotate diagram"]').trigger('click');
    await wrapper.get('button[aria-label="Select shape b"]').trigger('click');
    wrapper.getComponent({ name: 'AnnotationPopup' }).vm.$emit('submit', 'Rename this to worker');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(wrapper.emitted('annotate')).toEqual([[{
      visualizationId: 'v',
      title: 'Map',
      revision: 3,
      comment: 'Rename this to worker',
      elements: [{ id: 'b', type: 'rectangle' }],
    }]]);
    expect(editor.setSelection).toHaveBeenLastCalledWith([]);
    expect(wrapper.find('.visualize-editor__annotation-layer').exists()).toBe(true);
    expect(wrapper.get('button[aria-label="Select shape b"]').attributes('aria-pressed')).toBe('false');
    await wrapper.get('button[aria-label="Select shape b"]').trigger('click');
    wrapper.getComponent({ name: 'AnnotationPopup' }).vm.$emit('submit', 'Make it blue');
    await flushPromises();
    expect(wrapper.emitted('annotate')).toHaveLength(2);
    expect(wrapper.emitted('annotate')?.[1]?.[0]).toMatchObject({ comment: 'Make it blue', elements: [{ id: 'b' }] });
  });
  it('downloads the current canvas as a named PNG', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save: vi.fn(), sessionId: 'session' } });
    await flushPromises();
    await wrapper.get('button[aria-label="Save as PNG"]').trigger('click');
    await flushPromises();
    expect(editor.preview).toHaveBeenCalledWith(expect.objectContaining({ elements: canvas.elements }));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('Map.png');
    expect(anchor.href).toBe('data:image/png;base64,YQ==');
  });
  it('refreshes the persisted thumbnail after an agent batch even without further user edits', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (input: SaveCanvasInput) => ({ ...input.document, revision: input.expectedRevision + 1 }));
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save, sessionId: 'session' } });
    await flushPromises();
    const agentEdit = { ...structuredClone(canvas), revision: 2 };
    agentEdit.elements[0].text = 'Agent label';
    await wrapper.setProps({ visualization: { ...visualization, canvas: agentEdit } });
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({ expectedRevision: 2, document: { preview: 'data:image/png;base64,YQ==' } });
    wrapper.unmount();
    vi.useRealTimers();
  });
  it('applies an agent batch as one undoable editor update and does not overwrite unsaved local work', async () => {
    const save = vi.fn();
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save, sessionId: 'session' } });
    await flushPromises();
    const agentEdit = { ...structuredClone(canvas), revision: 2 };
    agentEdit.elements[0].text = 'Agent label';
    await wrapper.setProps({ visualization: { ...visualization, canvas: agentEdit } });
    expect(editor.update).toHaveBeenCalledWith(agentEdit, true);
    const local = structuredClone(agentEdit);
    local.elements[0].x = 90;
    editor.change(local);
    const newer = { ...structuredClone(agentEdit), revision: 3 };
    newer.elements[0].text = 'Concurrent';
    await wrapper.setProps({ visualization: { ...visualization, canvas: newer } });
    expect(wrapper.get('[role="status"]').text()).toContain('local edits are preserved');
    expect(editor.update).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
  it('shows a failed save, retries retained edits and cleans up the editor', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockImplementation(async (input: SaveCanvasInput) => ({ ...input.document, revision: 2 }));
    const wrapper = mount(ExcalidrawCanvas, { props: { visualization, save, sessionId: 'session' } });
    await flushPromises();
    const moved = structuredClone(canvas);
    moved.elements[0].x = 80;
    editor.change(moved);
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper.text()).toContain('Disk full');
    await wrapper.findAll('button[type="button"]').find(button => button.text() === 'Retry save')!.trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].document.elements[0].x).toBe(80);
    wrapper.unmount();
    expect(editor.dispose).toHaveBeenCalledOnce();
  });
});
