import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import type { DesignRequest, DesignResult, DesignWorkspace } from '@workspace/core/design';
import DesignPanel from '../DesignPanel.vue';

const editableWorkspace = (): DesignWorkspace => ({
  conversationRef: null, isOpen: true, selectedArtboardId: 'desktop', selectedNodeId: 'heading', undo: [], checkpoints: [],
  document: { id: 'design-a', revision: 1, content: { title: 'Page', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'page', tag: 'main', children: [{ id: 'heading', tag: 'h1', text: 'Hello' }, { id: 'cta', tag: 'button', text: 'Continue' }] } }] } },
});

// Unsent feedback must keep its original identity/revision after selection or
// content changes, and remain available to discard after a rejected submission.
it('keeps an element comment attached to its original target until sent or discarded', async () => {
  const workspace = editableWorkspace();
  const execute = vi.fn(async () => ({ workspace: structuredClone(workspace) }));
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute } });
  try {
    await wrapper.get('textarea[aria-label="Element comment"]').setValue('Make the heading larger');
    const changed = structuredClone(workspace);
    changed.selectedNodeId = 'cta';
    changed.document!.revision = 2;
    changed.document!.content.artboards[0].root.children!.shift();
    await wrapper.setProps({ workspace: changed });
    expect(wrapper.text()).toContain('Comment on h1 · Hello');
    execute.mockRejectedValueOnce(new Error('Stale design revision'));
    await wrapper.get('[data-action="comment"]').trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'comment', expectedRevision: 1, nodeId: 'heading', text: 'Make the heading larger' });
    expect((wrapper.get('textarea[aria-label="Element comment"]').element as HTMLTextAreaElement).value).toBe('Make the heading larger');
    // Losing selection must not hide the only way to recover this draft.
    await wrapper.setProps({ workspace: { ...changed, selectedNodeId: null } });
    await wrapper.get('[data-action="discard-comment"]').trigger('click');
    expect(wrapper.find('textarea[aria-label="Element comment"]').exists()).toBe(false);
    await wrapper.setProps({ workspace: changed });
    await wrapper.get('textarea[aria-label="Element comment"]').setValue('Clarify the next step');
    execute.mockResolvedValueOnce({ workspace: changed });
    await wrapper.get('[data-action="comment"]').trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'comment', expectedRevision: 2, nodeId: 'cta', text: 'Clarify the next step' });
    expect((wrapper.get('textarea[aria-label="Element comment"]').element as HTMLTextAreaElement).value).toBe('');
  } finally { wrapper.unmount(); }
});

// A pending save must not accept input that its response would then discard;
// success and failure must both restore editing, with failed drafts retained.
it.each([true, false])('prevents inspector edits during Apply and restores editing after success=%s', async success => {
  const workspace = editableWorkspace();
  let resolve!: (result: DesignResult) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<DesignResult>((done, fail) => { resolve = done; reject = fail; });
  const execute = vi.fn(() => pending);
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute } });
  try {
    await wrapper.get('textarea[aria-label="Text"]').setValue('First edit');
    await wrapper.get('[data-action="apply"]').trigger('click');
    const controls = ['textarea[aria-label="Text"]', 'input[aria-label="Text color"]', 'select[aria-label="Display"]', 'select[aria-label="On click"]'];
    for (const selector of controls) expect(wrapper.get(selector).element.matches(':disabled')).toBe(true);
    expect(execute).toHaveBeenCalledWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'text', nodeId: 'heading', text: 'First edit' }] });
    if (success) {
      const saved = structuredClone(workspace);
      saved.document!.revision = 2;
      saved.document!.content.artboards[0].root.children![0].text = 'First edit';
      resolve({ workspace: saved });
    } else reject(new Error('Save failed'));
    await flushPromises();
    for (const selector of controls) expect(wrapper.get(selector).element.matches(':disabled')).toBe(false);
    expect((wrapper.get('textarea[aria-label="Text"]').element as HTMLTextAreaElement).value).toBe('First edit');
    expect(wrapper.get('[data-action="apply"]').element.matches(':disabled')).toBe(success);
    await wrapper.get('textarea[aria-label="Text"]').setValue('Second edit');
    expect((wrapper.get('textarea[aria-label="Text"]').element as HTMLTextAreaElement).value).toBe('Second edit');
    expect(wrapper.get('[data-action="apply"]').element.matches(':disabled')).toBe(false);
  } finally { wrapper.unmount(); }
});

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
  expect(execute).toHaveBeenLastCalledWith({ type: 'read' });
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

// Rejection may follow a persisted choice. Retrying must review fresh state,
// retain revision checks, and submit only after another explicit confirmation.
it('returns rejected coding handoffs to review and confirms the latest saved direction', async () => {
  const workspace: DesignWorkspace = {
    conversationRef: null, isOpen: true, selectedArtboardId: 'desktop', selectedNodeId: null, undo: [], checkpoints: [],
    document: { id: 'design-a', revision: 1, content: { title: 'Page', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'page', tag: 'main', text: 'Hello' } }] } },
  };
  let rejectProvider = true;
  const execute = vi.fn(async (request: DesignRequest) => {
    if (request.type === 'implement') {
      if (request.expectedRevision !== workspace.document!.revision) throw new Error('Stale design revision');
      workspace.document!.revision++;
      workspace.document!.content.chosenArtboardId = request.artboardId;
      if (rejectProvider) throw new Error('Provider rejected coding request');
    }
    return { workspace: structuredClone(workspace) };
  });
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace: structuredClone(workspace), execute } });
  try {
    const review = async () => { await wrapper.get('[data-action="build"]').trigger('click'); await flushPromises(); };
    const send = async () => { await wrapper.get('[data-action="implement"]').trigger('click'); await flushPromises(); };
    await review(); await send();
    expect(wrapper.find('[data-action="implement"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('Provider rejected');
    workspace.document!.revision++;
    workspace.document!.content.artboards[0].title = 'Refined direction';
    await review();
    expect(wrapper.get('.design-panel__build-summary').text()).toContain('Refined direction');
    expect(execute).toHaveBeenLastCalledWith({ type: 'read' });
    // A change after review must still be rejected instead of silently accepted.
    workspace.document!.revision++;
    await send();
    expect(wrapper.get('[role="alert"]').text()).toContain('Stale');
    rejectProvider = false;
    await review();
    expect(execute).toHaveBeenLastCalledWith({ type: 'read' });
    await send();
    expect(execute).toHaveBeenLastCalledWith({ type: 'implement', expectedRevision: 4, artboardId: 'desktop' });
    expect(wrapper.find('[data-action="implement"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  } finally { wrapper.unmount(); }
});
