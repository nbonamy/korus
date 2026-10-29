import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import type { DesignWorkspace } from '@workspace/core/design';
import DesignPanel from '../DesignPanel.vue';

// Isolated editor failure modes: saving the wrong stable target, dropping a draft
// on a background revision, stale overwrite, and granting preview app authority.
it('edits a stable selected node, retains conflicting drafts, routes comments and separates Play', async () => {
  const workspace: DesignWorkspace = {
    conversationRef: null, isOpen: true, selectedArtboardId: 'desktop', selectedNodeId: 'heading', undo: [], checkpoints: [],
    document: { id: 'design-a', revision: 1, content: { title: 'Page', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'page', tag: 'main', children: [{ id: 'heading', tag: 'h1', text: 'Hello' }] } }] } },
  };
  const execute = vi.fn(async () => ({ workspace: structuredClone(workspace) }));
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute } });
  const text = wrapper.get('textarea[aria-label="Text"]');
  await text.setValue('My draft');
  await wrapper.setProps({ workspace: { ...workspace, document: { ...workspace.document!, revision: 2 } } });
  expect((text.element as HTMLTextAreaElement).value).toBe('My draft');
  execute.mockRejectedValueOnce(new Error('Stale design revision. Reread before editing.'));
  await wrapper.get('button[data-action="apply"]').trigger('click');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'text', nodeId: 'heading', text: 'My draft' }] });
  expect(wrapper.get('[role="alert"]').text()).toContain('Stale');
  expect((text.element as HTMLTextAreaElement).value).toBe('My draft');
  await wrapper.get('button[data-action="reload"]').trigger('click');
  await flushPromises();
  await wrapper.get('textarea[aria-label="Element comment"]').setValue('Keep this');
  await wrapper.get('button[data-action="comment"]').trigger('click');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'comment', expectedRevision: 1, nodeId: 'heading', text: 'Keep this' });
  const frame = wrapper.get('iframe');
  expect(wrapper.find('.design-tools button[aria-label="Artboard actions"]').exists()).toBe(false);
  await wrapper.get('button[aria-label="Hide inspector"]').trigger('click');
  await wrapper.get('button[aria-label="Comment on this proposal"]').trigger('click');
  await flushPromises();
  expect(wrapper.find('.design-panel__inspector').isVisible()).toBe(false);
  await wrapper.get('textarea[aria-label="Proposal comment"]').setValue('Make the next step clearer');
  await wrapper.get('form[aria-label="Comment on Desktop"]').trigger('submit');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'comment', expectedRevision: 1, nodeId: 'page', text: 'Make the next step clearer' });
  await wrapper.get('button[data-action="build"]').trigger('click');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'comment', expectedRevision: 1, nodeId: 'page', text: 'Make the next step clearer' });
  await wrapper.get('button[data-action="implement"]').trigger('click');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'implement', expectedRevision: 1, artboardId: 'desktop' });
  expect(frame.attributes('sandbox')).toBe('allow-scripts');
  expect(frame.attributes('srcdoc')).toContain("default-src 'none'");
  await wrapper.get('button[data-action="play"]').trigger('click');
  expect(wrapper.find('textarea[aria-label="Text"]').exists()).toBe(false);
  expect(wrapper.get('button[data-action="play"]').attributes('aria-pressed')).toBe('true');
  wrapper.unmount();
});
