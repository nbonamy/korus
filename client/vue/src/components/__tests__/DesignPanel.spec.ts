import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import { ElTree } from 'element-plus';
import type { DesignRequest, DesignResult, DesignWorkspace } from '@workspace/core/design';
import DesignPanel from '../DesignPanel.vue';

const editableWorkspace = (): DesignWorkspace => ({
  conversationRef: null, isOpen: true, selectedArtboardId: 'desktop', selectedNodeId: 'heading', undo: [], checkpoints: [],
  document: { id: 'design-a', revision: 1, content: { title: 'Page', css: '', comments: [], artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'page', tag: 'main', children: [{ id: 'heading', tag: 'h1', text: 'Hello' }, { id: 'cta', tag: 'button', text: 'Continue' }] } }] } },
});

const typeText = async (wrapper: ReturnType<typeof mount>, value: string) => {
  const input = wrapper.get('textarea[aria-label="Text"]');
  (input.element as HTMLTextAreaElement).value = value;
  await input.trigger('input');
};

it('fits once and preserves zoom through sidebar resizes until the next explicit fit', async () => {
  let resize!: (width: number, height?: number) => void;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (target.matches('.design-canvas')) resize = (width, height = 700) => this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  const workspace = editableWorkspace();
  const wrapper = mount(DesignPanel, { attachTo: document.body, props: { agentId: 'designer', workspace, execute: vi.fn(async () => ({ workspace })) }, global: { components: { ElTree } } });
  const width = () => wrapper.get('.design-canvas__artboard').attributes('style');
  const fit = async (label: string) => {
    await wrapper.get('button[aria-label="Zoom"]').trigger('click');
    await flushPromises();
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === label);
    expect(item).toBeDefined();
    item!.click();
    await flushPromises();
  };
  try {
    // Restored tabs can mount hidden; defer the initial fit until visible.
    resize(0, 0);
    await flushPromises();
    resize(700);
    await flushPromises();
    const initial = width();
    expect(initial).toContain('width: 636px');
    resize(500);
    await flushPromises();
    expect(width()).toBe(initial);
    for (const label of ['Fit all artboards', 'Fit artboard']) {
      await fit(label);
      const fitted = width();
      expect(fitted).not.toBe(initial);
      resize(600);
      await flushPromises();
      expect(width()).toBe(fitted);
      await fit(label);
      expect(width()).not.toBe(fitted);
      resize(500);
      await flushPromises();
    }
    const beforeWheel = width();
    wrapper.get('.design-canvas').element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -40 }));
    await flushPromises();
    const manual = width();
    expect(manual).not.toBe(beforeWheel);
    resize(700);
    await flushPromises();
    expect(width()).toBe(manual);
  } finally { wrapper.unmount(); vi.unstubAllGlobals(); }
});

it('resizes and drags the inspector closed without losing drafts or its restored width', async () => {
  vi.useFakeTimers();
  const workspace = editableWorkspace();
  const wrapper = mount(DesignPanel, { attachTo: document.body, props: { agentId: 'designer', workspace, execute: vi.fn(async () => ({ workspace })) }, global: { components: { ElTree } } });
  try {
    vi.spyOn(wrapper.get('.design-panel__body').element, 'getBoundingClientRect').mockReturnValue({ width: 1000 } as DOMRect);
    await typeText(wrapper, 'Keep this draft');
    const pointer = (type: string, clientX: number) => new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX });
    const divider = wrapper.get('[role="separator"][aria-label="Resize inspector"]');
    divider.element.dispatchEvent(pointer('pointerdown', 720));
    window.dispatchEvent(pointer('pointermove', 640));
    await flushPromises();
    const shell = wrapper.get('.design-panel__inspector-shell');
    expect(shell.attributes('style')).toContain('--design-inspector-width: 360px');
    window.dispatchEvent(pointer('pointerup', 640));
    await divider.trigger('keydown', { key: 'ArrowLeft' });
    expect(shell.attributes('style')).toContain('--design-inspector-width: 376px');
    divider.element.dispatchEvent(pointer('pointerdown', 624));
    window.dispatchEvent(pointer('pointermove', 850));
    await flushPromises();
    expect(shell.isVisible()).toBe(false);
    // Reversing the same gesture reopens the pane even after it disappears.
    window.dispatchEvent(pointer('pointermove', 624));
    await flushPromises();
    expect(shell.isVisible()).toBe(true);
    window.dispatchEvent(pointer('pointermove', 850));
    window.dispatchEvent(pointer('pointerup', 850));
    await flushPromises();
    await wrapper.get('button[aria-label="Show inspector"]').trigger('click');
    expect(shell.isVisible()).toBe(true);
    expect(shell.attributes('style')).toContain('--design-inspector-width: 376px');
    expect((wrapper.get('textarea[aria-label="Text"]').element as HTMLTextAreaElement).value).toBe('Keep this draft');
  } finally { wrapper.unmount(); vi.useRealTimers(); }
});

it('clears element selection from the canvas background and on entering Pan', async () => {
  const workspace = editableWorkspace();
  const execute = vi.fn(async (request: DesignRequest) => {
    if (request.type === 'select') { workspace.selectedArtboardId = request.artboardId; workspace.selectedNodeId = request.nodeId; }
    return { workspace: structuredClone(workspace) };
  });
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute }, global: { components: { ElTree } } });
  try {
    await wrapper.get('.design-canvas').trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'select', artboardId: 'desktop', nodeId: null });
    expect(wrapper.find('textarea[aria-label="Text"]').exists()).toBe(false);
    await wrapper.get('[title="h1 · heading — Hello"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('textarea[aria-label="Text"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="Pan canvas"]').trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'select', artboardId: 'desktop', nodeId: null });
    expect(wrapper.find('textarea[aria-label="Text"]').exists()).toBe(false);
  } finally { wrapper.unmount(); }
});

it('fills applied properties without saving them and only persists fields edited by the user', async () => {
  vi.useFakeTimers();
  const workspace = editableWorkspace();
  const heading = workspace.document!.content.artboards[0].root.children![0];
  heading.styles = { 'font-size': '1.5rem' };
  let resolve!: (result: DesignResult) => void;
  const pending = new Promise<DesignResult>(done => { resolve = done; });
  const execute = vi.fn(async () => pending);
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute }, global: { components: { ElTree } } });
  const field = (label: string) => wrapper.get<HTMLInputElement>(`input[aria-label="${label}"]`);
  const inspect = (properties: Record<string, string>) => {
    const frame = wrapper.get('iframe');
    const token = frame.attributes('srcdoc')!.match(/<script nonce="([^"]+)"/)![1];
    window.dispatchEvent(new MessageEvent('message', { source: (frame.element as HTMLIFrameElement).contentWindow, data: {
      kind: 'styles', token, revision: 1, nodeId: 'heading', styles: { 'font-size': '24px' }, properties,
    } }));
  };
  const properties = { width: '600px', height: '32px', padding: '8px 12px', margin: '0px', position: 'static', 'font-size': '24px', 'line-height': '32px', 'letter-spacing': '-1px', opacity: '1' };
  try {
    inspect(properties);
    await flushPromises();
    expect(field('Width').element.value).toBe('600px');
    expect(field('Padding').element.value).toBe('8px 12px');
    expect(field('Font size').element.value).toBe('1.5rem');
    expect(field('Line height').element.value).toBe('32px');
    expect(field('Letter spacing').element.value).toBe('-1px');
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="Position"]').element.value).toBe('static');
    await vi.advanceTimersByTimeAsync(400);
    expect(execute).not.toHaveBeenCalled();
    field('Width').element.value = '640px';
    await field('Width').trigger('input');
    inspect({ ...properties, width: '610px' });
    await flushPromises();
    expect(field('Width').element.value).toBe('640px');
    await vi.advanceTimersByTimeAsync(400);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'style', nodeId: 'heading', styles: { width: '640px' } }] });
    field('Height').element.value = '40px';
    await field('Height').trigger('input');
    heading.styles.width = '640px';
    workspace.document!.revision = 2;
    resolve({ workspace: structuredClone(workspace) });
    await flushPromises();
    execute.mockResolvedValue({ workspace: structuredClone(workspace) });
    await vi.advanceTimersByTimeAsync(400);
    expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: 2, edits: [{ type: 'style', nodeId: 'heading', styles: { height: '40px' } }] });
  } finally { wrapper.unmount(); vi.useRealTimers(); }
});

it.each([true, false])('preserves edits typed during autosave and recovers after success=%s', async success => {
  vi.useFakeTimers();
  const workspace = editableWorkspace();
  let resolve!: (result: DesignResult) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<DesignResult>((done, fail) => { resolve = done; reject = fail; });
  const execute = vi.fn(async (request: DesignRequest) => {
    if (request.type === 'edit') {
      workspace.document!.revision++;
      workspace.document!.content.artboards[0].root.children![0].text = success ? 'Second edit' : 'Retry edit';
    }
    return { workspace: structuredClone(workspace) };
  }).mockImplementationOnce(() => pending);
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute }, global: { components: { ElTree } } });
  try {
    expect(wrapper.find('[data-action="apply"]').exists()).toBe(false);
    await typeText(wrapper, 'First edit');
    await vi.advanceTimersByTimeAsync(400);
    expect(execute).toHaveBeenCalledWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'text', nodeId: 'heading', text: 'First edit' }] });
    await typeText(wrapper, 'Second edit');
    await vi.advanceTimersByTimeAsync(400);
    expect(execute).toHaveBeenCalledOnce();
    expect(wrapper.get('textarea[aria-label="Text"]').element.matches(':disabled')).toBe(false);
    if (success) {
      workspace.document!.revision = 2;
      workspace.document!.content.artboards[0].root.children![0].text = 'First edit';
      resolve({ workspace: structuredClone(workspace) });
    } else reject(new Error('Save failed'));
    await flushPromises();
    expect((wrapper.get('textarea[aria-label="Text"]').element as HTMLTextAreaElement).value).toBe('Second edit');
    if (!success) {
      expect(wrapper.get('[role="alert"]').text()).toContain('Save failed');
      await typeText(wrapper, 'Retry edit');
    }
    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: success ? 2 : 1, edits: [{ type: 'text', nodeId: 'heading', text: success ? 'Second edit' : 'Retry edit' }] });
    expect((wrapper.get('textarea[aria-label="Text"]').element as HTMLTextAreaElement).value).toBe(success ? 'Second edit' : 'Retry edit');
  } finally { wrapper.unmount(); vi.useRealTimers(); }
});

// Isolated editor failure modes: saving the wrong stable target, dropping a draft
// on a background revision, stale overwrite, and granting preview app authority.
it('edits a stable selected node, retains conflicting drafts, routes comments and separates Play', async () => {
  const workspace: DesignWorkspace = {
    conversationRef: null, isOpen: true, selectedArtboardId: 'desktop', selectedNodeId: 'heading', undo: [], checkpoints: [],
    document: { id: 'design-a', revision: 1, content: { title: 'Page', css: '', comments: [], chosenArtboardId: 'desktop', artboards: [{ id: 'desktop', title: 'Desktop', notes: 'Proposal details stay out of the review bar.', width: 800, height: 600, root: { id: 'page', tag: 'main', children: [{ id: 'heading', tag: 'h1', text: 'Hello' }] } }] } },
  };
  const execute = vi.fn(async () => ({ workspace: structuredClone(workspace) }));
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute }, global: { components: { ElTree } } });
  expect(wrapper.get('.design-review-bar__actions').findAll('button')).toHaveLength(2);
  expect(wrapper.find('[aria-label="Chosen"]').exists()).toBe(false);
  expect(wrapper.get('.design-review-bar__summary').text()).toBe('Desktop');
  expect(wrapper.get('.design-review-bar__summary strong').attributes('title')).toBe('Desktop');
  const commentAction = wrapper.get('.design-review-bar button[aria-label="Comment on this proposal"]');
  expect(commentAction.text()).toBe('Comment');
  expect(commentAction.find('svg').exists()).toBe(true);
  const text = wrapper.get('textarea[aria-label="Text"]');
  await typeText(wrapper, 'My draft');
  await wrapper.setProps({ workspace: { ...workspace, document: { ...workspace.document!, revision: 2 } } });
  expect((text.element as HTMLTextAreaElement).value).toBe('My draft');
  execute.mockRejectedValueOnce(new Error('Stale design revision. Reread before editing.'));
  await text.trigger('change');
  await flushPromises();
  expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'text', nodeId: 'heading', text: 'My draft' }] });
  expect(wrapper.get('[role="alert"]').text()).toContain('Stale');
  expect((text.element as HTMLTextAreaElement).value).toBe('My draft');
  await wrapper.get('button[data-action="reload"]').trigger('click');
  await flushPromises();
  const frame = wrapper.get('iframe');
  await wrapper.findAll('.el-tabs__item').find(tab => tab.text() === 'Code')!.trigger('click');
  const token = frame.attributes('srcdoc')!.match(/<script nonce="([^"]+)"/)![1];
  window.dispatchEvent(new MessageEvent('message', { source: (frame.element as HTMLIFrameElement).contentWindow, data: { kind: 'styles', token, revision: 1, nodeId: 'heading', styles: { 'font-size': '24px' } } }));
  await vi.waitFor(() => expect(wrapper.get('.design-code').text()).toContain('font-size: 24px;'));
  expect(wrapper.get('.design-code').text()).not.toContain('body {');
  await wrapper.findAll('.el-tabs__item').find(tab => tab.text() === 'Properties')!.trigger('click');
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

it('edits generated color and numeric controls while rejecting invalid values', async () => {
  const workspace = editableWorkspace();
  const root = workspace.document!.content.artboards[0].root;
  root.styles = { '--accent': '#123456', '--radius': '12px' };
  workspace.document!.content.tweaks = [
    { id: 'accent', label: 'Chart accent', type: 'color', nodeId: 'page', property: '--accent' },
    { id: 'radius', label: 'Panel radius', type: 'range', nodeId: 'page', property: '--radius', min: 0, max: 32, step: 1, unit: 'px' },
  ];
  const execute = vi.fn(async (request: DesignRequest) => {
    if (request.type === 'edit') {
      for (const edit of request.edits) if (edit.type === 'tweak-value') root.styles![edit.tweakId === 'accent' ? '--accent' : '--radius'] = edit.tweakId === 'accent' ? String(edit.value) : `${edit.value}px`;
      workspace.document!.revision++;
    }
    return { workspace: structuredClone(workspace) };
  });
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace, execute }, global: { components: { ElTree } } });
  try {
    await wrapper.findAll('.el-tabs__item').find(tab => tab.text() === 'Tweaks')!.trigger('click');
    const hex = wrapper.get('input[aria-label="Chart accent hex color"]');
    await hex.setValue('#2a78d6');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: 1, edits: [{ type: 'tweak-value', tweakId: 'accent', value: '#2a78d6' }] });
    const number = wrapper.get('input[aria-label="Panel radius value"]');
    await number.setValue('20');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'edit', expectedRevision: 2, edits: [{ type: 'tweak-value', tweakId: 'radius', value: 20 }] });
    await hex.setValue('#oops');
    await number.setValue('99');
    expect(execute).toHaveBeenCalledTimes(2);
    expect((hex.element as HTMLInputElement).value).toBe('#2a78d6');
    expect((number.element as HTMLInputElement).value).toBe('20');
  } finally { wrapper.unmount(); }
});

// Rejection may follow a persisted handoff. Retrying must review fresh state,
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
      if (rejectProvider) throw new Error('Provider rejected coding request');
    }
    return { workspace: structuredClone(workspace) };
  });
  const wrapper = mount(DesignPanel, { props: { agentId: 'designer', workspace: structuredClone(workspace), execute }, global: { components: { ElTree } } });
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

it('undoes and redoes from the client\'s own history, including agent edits, by sending content to the daemon', async () => {
  localStorage.clear();
  const first = editableWorkspace();
  const second: DesignWorkspace = { ...first, document: { ...first.document!, revision: 2, content: { ...first.document!.content, title: 'Agent edit' } } };
  const execute = vi.fn(async (request: DesignRequest): Promise<DesignResult> => {
    if (request.type !== 'replace') throw new Error(`Unexpected ${request.type}`);
    return { workspace: { ...first, document: { ...first.document!, revision: request.expectedRevision + 1, content: request.content } } };
  });
  const wrapper = mount(DesignPanel, { attachTo: document.body, props: { agentId: 'designer', workspace: first, execute }, global: { components: { ElTree } } });
  const undo = () => wrapper.get('button[aria-label="Undo"]');
  const redo = () => wrapper.get('button[aria-label="Redo"]');
  try {
    expect(undo().attributes('disabled')).toBeDefined();
    await wrapper.setProps({ workspace: second }); // an edit made by the agent
    expect(undo().attributes('disabled')).toBeUndefined();
    await undo().trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'replace', expectedRevision: 2, content: first.document!.content });
    expect(undo().attributes('disabled')).toBeDefined();
    expect(redo().attributes('disabled')).toBeUndefined();
    await redo().trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'replace', expectedRevision: 3, content: second.document!.content });
    expect(JSON.parse(localStorage.getItem('design-history:designer')!)).toMatchObject({ documentId: 'design-a', revision: 4, redo: [] });
  } finally { wrapper.unmount(); localStorage.clear(); }
});

it('records one undo step for a text field edited across several autosaves', async () => {
  localStorage.clear();
  vi.useFakeTimers();
  const original = editableWorkspace();
  let saved = original;
  const execute = vi.fn(async (request: DesignRequest): Promise<DesignResult> => {
    if (request.type === 'edit') {
      const text = request.edits.find(edit => edit.type === 'text');
      saved = { ...saved, document: { ...saved.document!, revision: saved.document!.revision + 1, content: { ...saved.document!.content, title: `Page ${text && 'text' in text ? text.text : ''}` } } };
    } else if (request.type === 'replace') {
      saved = { ...saved, document: { ...saved.document!, revision: saved.document!.revision + 1, content: request.content } };
    }
    return { workspace: saved };
  });
  const wrapper = mount(DesignPanel, { attachTo: document.body, props: { agentId: 'designer', workspace: original, execute }, global: { components: { ElTree } } });
  try {
    for (const value of ['Hel', 'Hello wor', 'Hello world']) {
      await typeText(wrapper, value);
      await vi.advanceTimersByTimeAsync(450); // the autosave fires after each pause
      await flushPromises();
    }
    expect(execute.mock.calls.filter(([request]) => request.type === 'edit')).toHaveLength(3);
    expect(JSON.parse(localStorage.getItem('design-history:designer')!).undo).toHaveLength(1);
    await wrapper.get('button[aria-label="Undo"]').trigger('click');
    await flushPromises();
    expect(execute).toHaveBeenLastCalledWith({ type: 'replace', expectedRevision: 4, content: original.document!.content });
    expect(wrapper.get('button[aria-label="Undo"]').attributes('disabled')).toBeDefined();
  } finally { wrapper.unmount(); vi.useRealTimers(); localStorage.clear(); }
});

it('records separate undo steps for a text edit followed by a color edit', async () => {
  localStorage.clear();
  vi.useFakeTimers();
  const original = editableWorkspace();
  let saved = original;
  const execute = vi.fn(async (request: DesignRequest): Promise<DesignResult> => {
    if (request.type === 'edit') {
      const content = structuredClone(saved.document!.content);
      content.title = `${content.title}+${JSON.stringify(request.edits)}`;
      saved = { ...saved, document: { ...saved.document!, revision: saved.document!.revision + 1, content } };
    }
    return { workspace: saved };
  });
  const wrapper = mount(DesignPanel, { attachTo: document.body, props: { agentId: 'designer', workspace: original, execute }, global: { components: { ElTree } } });
  try {
    await typeText(wrapper, 'New headline');
    await vi.advanceTimersByTimeAsync(450);
    await flushPromises();
    const color = wrapper.get('input[aria-label="Text color"]');
    (color.element as HTMLInputElement).value = '#ff0000';
    await color.trigger('input');
    await vi.advanceTimersByTimeAsync(450);
    await flushPromises();
    const edits = execute.mock.calls.filter(([request]) => request.type === 'edit').map(([request]) => (request as { edits: Array<{ type: string }> }).edits.map(edit => edit.type));
    expect(edits).toEqual([['text'], ['style']]);
    expect(JSON.parse(localStorage.getItem('design-history:designer')!).undo).toHaveLength(2);
  } finally { wrapper.unmount(); vi.useRealTimers(); localStorage.clear(); }
});
