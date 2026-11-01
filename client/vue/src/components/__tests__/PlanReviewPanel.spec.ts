import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ElTooltip } from 'element-plus';
import type { PlanReview, PlanReviewResponse } from '@workspace/core/plan-review';
import PlanReviewPanel from '../PlanReviewPanel.vue';

const markdown = '# Delivery plan\n\nKeep existing data.\n\n## Platforms\n\n- [x] macOS\n- [ ] Windows\n- [ ] Linux\n\n## Storage\n\n- ( ) Project\n- (x) Home\n\n## Details\n\n| Before | After |\n| --- | --- |\n| Old | New |\n\n```text\n- ( ) Code example\n```';
const review = (): PlanReview => ({ id: 'review', conversationId: 'thread', turnId: 'turn', markdown, status: 'pending' });
const result = (current: PlanReview, response: PlanReviewResponse): PlanReview => response.resolution === 'save'
  ? { ...current, draft: response.draft, draftVersion: response.draftVersion! + 1 }
  : { ...current, status: response.resolution };
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(b => b.text() === text)!;
const save = async () => { await new Promise(resolve => setTimeout(resolve, 400)); await flushPromises(); };

describe('Markdown plan review', () => {
  it('renders read-only diagrams and preserves separate whole-diagram comments through reload and revision', async () => {
    const sources = ['flowchart LR\n Client --> API\n API --> Store', 'sequenceDiagram\n Client->>API: Load plan'];
    let current: PlanReview = { ...review(), markdown: `# Architecture\n\n${sources.map(source => '```mermaid\n' + source + '\n```').join('\n\n')}\n\n\`\`\`text\nordinary code\n\`\`\`` };
    const respond = vi.fn(async (response: PlanReviewResponse) => current = result(current, response));
    let wrapper = mount(PlanReviewPanel, { props: { review: current, respond }, attachTo: document.body });
    try {
      const diagrams = wrapper.findAll('figure');
      expect(diagrams).toHaveLength(2);
      expect(decodeURIComponent(diagrams[0]!.get('img').attributes('src')!)).toContain('Store');
      expect(decodeURIComponent(diagrams[1]!.get('img').attributes('src')!)).toContain('Load plan');
      expect(wrapper.get('pre code').text()).toBe('ordinary code');
      expect(wrapper.find('canvas,[contenteditable="true"]').exists()).toBe(false);
      for (const [index, diagram] of diagrams.entries()) {
        const comment = diagram.get('button[aria-label^="Comment on diagram"]');
        await comment.trigger('click');
        const editor = wrapper.findAll('textarea').find(input => input.isVisible())!;
        await editor.setValue(`Feedback for diagram ${index + 1}`);
        await save();
        await editor.trigger('keydown', { key: 'Escape' });
        expect(document.activeElement).toBe(comment.element);
      }
      expect(current.draft?.comments.map(comment => comment.body)).toEqual(['Feedback for diagram 1', 'Feedback for diagram 2']);
      expect(new Set(current.draft?.comments.map(comment => comment.id)).size).toBe(2);
      current.draft?.comments.forEach((comment, index) => {
        expect(comment.sectionId).toBe('s0');
        expect(comment.quote).toContain(sources[index]);
      });
      wrapper.unmount();
      wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
      expect(wrapper.findAll('.comment-preview').map(comment => comment.text())).toEqual(['Feedback for diagram 1', 'Feedback for diagram 2']);
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ resolution: 'revise' }));
      expect(respond.mock.calls.some(([response]) => response.resolution === 'accept')).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('keeps invalid diagram source readable and disables its comments after approval', async () => {
    const source = 'not-a-diagram <script>run()</script>';
    const current: PlanReview = { ...review(), markdown: '# Diagram\n\n```mermaid\n' + source + '\n```\n\nThe rest of the plan stays readable.' };
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond: vi.fn(async response => result(current, response)) } });
    try {
      expect(wrapper.get('figure pre code').text()).toBe(source);
      expect(wrapper.text()).toContain('The rest of the plan stays readable.');
      expect(wrapper.find('script').exists()).toBe(false);
      await wrapper.setProps({ review: { ...current, status: 'accept' } });
      expect(wrapper.get('figure button[aria-label^="Comment on diagram"]').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it('keeps normal Markdown and sends selected checkbox/radio choices directly through Revise', async () => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      expect(wrapper.get('h1').text()).toBe('Delivery plan');
      expect(wrapper.findAll('table')).toHaveLength(1);
      expect(wrapper.get('pre').text()).toContain('- ( ) Code example');
      expect(wrapper.findAll('.plan-choice-option input[type="checkbox"]')).toHaveLength(3);
      expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
      expect(respond).not.toHaveBeenCalled();
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeDefined();
      await wrapper.findAll('.plan-choice-option input[type="checkbox"]')[2]!.setValue();
      await wrapper.findAll('input[type="radio"]')[0]!.setValue();
      expect(wrapper.find('[role="switch"]').exists()).toBe(false);
      await button(wrapper, 'Revise').trigger('click');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      await flushPromises();
      expect(respond.mock.calls.map(c => c[0].resolution)).toEqual(['save', 'revise']);
      expect(respond.mock.calls[0]![0].draft).toStrictEqual({ comments: [], choices: [
        { id: 's1-g0', quote: 'Platforms\nmacOS\nWindows\nLinux', selected: ['macOS', 'Linux'], confirmed: true },
        { id: 's2-g1', quote: 'Storage\nProject\nHome', selected: ['Project'], confirmed: true },
      ] });
      expect(respond).toHaveBeenLastCalledWith({ reviewId: current.id, resolution: 'revise', draftVersion: 1 });
      expect(button(wrapper, 'Approve').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it.each(['revise', 'accept'] as const)('submits %s directly with unanswered questions and flushes edited choices', async resolution => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await wrapper.findAll('.plan-choice-option input[type="checkbox"]')[1]!.setValue();
      const action = resolution === 'accept' ? 'Approve' : 'Revise';
      await button(wrapper, action).trigger('click');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      await flushPromises();
      expect(respond.mock.calls.map(([r]) => r.resolution)).toEqual(['save', resolution]);
    } finally { wrapper.unmount(); }
  });

  it('approves an untouched proposal directly without creating choice feedback', async () => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await button(wrapper, 'Approve').trigger('click');
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      await flushPromises();
      expect(respond).toHaveBeenCalledExactlyOnceWith({ reviewId: current.id, resolution: 'accept', draftVersion: 0 });
    } finally { wrapper.unmount(); }
  });

  it('preserves selected answers across reload and removes them when reset to the proposal', async () => {
    let current = review();
    const respond = vi.fn(async response => { current = result(current, response); return current; });
    let wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await wrapper.findAll('.plan-choice-option input[type="checkbox"]')[1]!.setValue();
      await wrapper.findAll('input[type="radio"]')[0]!.setValue();
      await save();
      expect(current.draft?.choices).toEqual([
        expect.objectContaining({ selected: ['macOS', 'Windows'], confirmed: true }),
        expect.objectContaining({ selected: ['Project'], confirmed: true }),
      ]);
      wrapper.unmount();
      wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
      expect(wrapper.find('[role="switch"]').exists()).toBe(false);
      expect(wrapper.findAll('input[type="radio"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([true, false]);
      await wrapper.findAll('.plan-choice-group')[0]!.get('button[aria-label="Reset"]').trigger('click');
      await save();
      expect(current.draft?.choices).toHaveLength(1);
      expect(wrapper.findAll('.plan-choice-option input[type="checkbox"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([true, false, false]);
    } finally { wrapper.unmount(); }
  });

  it('keeps ordinary Markdown and native review actions when interactive choices are disabled', async () => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond, interactive: false } });
    try {
      expect(wrapper.find('.plan-choice-group').exists()).toBe(false);
      expect(wrapper.find('input[type="radio"]').exists()).toBe(false);
      expect(wrapper.findAll('input[type="checkbox"]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
      expect(wrapper.text()).toContain('(x) Home');
      await wrapper.get('button[aria-label="Comment on this section: Platforms"]').trigger('click');
      await wrapper.get('textarea').setValue('Keep Linux.');
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond.mock.calls.map(call => call[0].resolution)).toEqual(['save', 'revise']);
      expect(respond.mock.calls[0]![0].draft.choices).toEqual([]);
    } finally { wrapper.unmount(); }
  });

  it('includes restored answers on Revise without requiring a separate confirmation', async () => {
    const current: PlanReview = { ...review(), draft: { comments: [], choices: [{ id: 's2-g1', quote: 'Storage', selected: ['Home'], confirmed: false }] } };
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      expect(wrapper.findAll('input[type="radio"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([false, true]);
      await save();
      expect(respond).not.toHaveBeenCalled();
      expect(wrapper.find('[role="switch"]').exists()).toBe(false);
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond.mock.calls[0]![0].draft.choices[0].selected).toEqual(['Home']);
      expect(respond.mock.calls[0]![0].draft.choices[0].confirmed).toBe(true);
      expect(respond.mock.calls.map(([response]) => response.resolution)).toEqual(['save', 'revise']);
    } finally { wrapper.unmount(); }
  });

  it('toggles inline comments, preserves focus and draft DOM across saves, and keeps the footer steady', async () => {
    const current = review();
    let complete!: () => void;
    const respond = vi.fn((response: PlanReviewResponse) => new Promise<PlanReview>(resolve => { complete = () => resolve(result(current, response)); }));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond }, attachTo: document.body });
    try {
      const toggle = wrapper.get('button[aria-label="Comment on this section: Platforms"]');
      await toggle.trigger('click');
      await flushPromises();
      const editor = wrapper.get('textarea');
      expect(document.activeElement).toBe(editor.element);
      for (const text of ['A', 'AB']) {
        await editor.setValue(text);
        await save();
        expect(wrapper.get('footer').findAll('button').every(b => !(b.element as HTMLButtonElement).disabled)).toBe(true);
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        complete();
        await flushPromises();
        await wrapper.setProps({ review: result(current, respond.mock.calls.at(-1)![0]) });
        expect(wrapper.get('textarea').element).toBe(editor.element);
      }
      await toggle.trigger('click');
      expect(editor.isVisible()).toBe(false);
      await wrapper.get('.comment-preview').trigger('click');
      expect(editor.isVisible()).toBe(true);
      await editor.trigger('keydown', { key: 'Escape' });
      expect(editor.isVisible()).toBe(false);
      expect(document.activeElement).toBe(toggle.element);
    } finally { complete?.(); wrapper.unmount(); }
  });

  it.each(['accept', 'cancel'] as const)('flushes pending comments before explicit %s', async resolution => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await wrapper.get('button[aria-label="Comment on this section: Platforms"]').trigger('click');
      await wrapper.get('textarea').setValue('Keep Linux.');
      await button(wrapper, resolution === 'accept' ? 'Approve' : 'Cancel').trigger('click');
      await flushPromises();
      expect(respond.mock.calls.map(c => c[0].resolution)).toEqual(['save', resolution]);
      expect(respond).toHaveBeenLastCalledWith({ reviewId: current.id, resolution, draftVersion: 1 });
    } finally { wrapper.unmount(); }
  });

  it.each(['failure', 'new review'])('does not approve when a pending save ends with %s', async outcome => {
    const current = review();
    let complete!: () => void;
    const respond = vi.fn((response: PlanReviewResponse) => new Promise<PlanReview>((resolve, reject) => { complete = () => outcome === 'failure' ? reject(Error('Save failed')) : resolve(result(current, response)); }));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await wrapper.findAll('.plan-choice-option input[type="checkbox"]')[1]!.setValue();
      await button(wrapper, 'Approve').trigger('click');
      expect(respond).toHaveBeenCalledOnce();
      if (outcome === 'new review') await wrapper.setProps({ review: { ...review(), id: 'new', conversationId: 'other' } });
      complete();
      await flushPromises();
      expect(respond).toHaveBeenCalledOnce();
      if (outcome === 'failure') expect(wrapper.get('[role="alert"]').text()).toBe('Save failed');
    } finally { complete?.(); wrapper.unmount(); }
  });

  it('recovers a save or revision failure without losing feedback', async () => {
    const current = review();
    const respond = vi.fn().mockRejectedValueOnce(Error('Disk full')).mockImplementation(async r => result(current, r));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      await wrapper.findAll('input[type="radio"]')[0]!.setValue();
      await save();
      expect(wrapper.get('[role="alert"]').text()).toBe('Disk full');
      await button(wrapper, 'Retry save').trigger('click');
      await flushPromises();
      respond.mockRejectedValueOnce(Error('Offline'));
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBe('Offline');
      const failedCalls = respond.mock.calls.length;
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith({ reviewId: current.id, resolution: 'revise', draftVersion: 1 });
      expect(respond).toHaveBeenCalledTimes(failedCalls + 1);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('restores feedback and lets users reset a choice to the unanswered proposal', async () => {
    const current: PlanReview = { ...review(), draftVersion: 3, draft: { comments: [{ id: 's1', sectionId: 's1', quote: 'Platforms', body: 'Keep all platforms.' }], choices: [{ id: 's2-g1', quote: 'Storage', selected: ['Project'] }] } };
    const respond = vi.fn(async r => result(current, r));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond }, attachTo: document.body, global: { components: { ElTooltip } } });
    try {
      expect(wrapper.get('.comment-preview').text()).toBe('Keep all platforms.');
      expect((wrapper.findAll('input[type="radio"]')[0]!.element as HTMLInputElement).checked).toBe(true);
      const reset = wrapper.get('button[aria-label="Reset"]');
      expect(reset.text()).toBe('');
      await reset.trigger('mouseenter');
      await vi.waitFor(() => {
        const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
        expect(tooltip?.textContent).toBe('Reset');
        expect(tooltip && getComputedStyle(tooltip).display).not.toBe('none');
      });
      expect(reset.get('svg').attributes('aria-hidden')).toBe('true');
      await reset.trigger('click');
      await save();
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ draftVersion: 3, draft: { ...current.draft, choices: [] } }));
      expect(wrapper.findAll('input[type="radio"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([false, true]);
    } finally { wrapper.unmount(); }
  });

  it('keeps code, mixed/nested lists, malformed radio groups and hostile HTML inert', () => {
    const current = { ...review(), markdown: '# <script>run()</script>\n\n- (x) One\n- (x) Two\n\n- Plain\n- ( ) Mixed\n\n> - ( ) Quote\n> - ( ) Quote two\n\n- [ ] Parent\n  - [ ] Child\n\n```html\n<input onclick="run()">\n```\n\n[Bad](javascript:run())' };
    const wrapper = mount(PlanReviewPanel, { props: { review: current } });
    try {
      expect(wrapper.findAll('.plan-choice-group')).toHaveLength(0);
      expect(wrapper.find('script,[onclick],a[href^="javascript:"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('<script>run()</script>');
    } finally { wrapper.unmount(); }
  });

  it('anchors selected-text feedback to its section', async () => {
    const current = review();
    const respond = vi.fn(async r => result(current, r));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond }, attachTo: document.body });
    try {
      const text = wrapper.get('.plan-review-section__body p').element.firstChild!;
      const range = document.createRange(); range.selectNodeContents(text);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      await wrapper.get('.plan-review-section__body').trigger('mouseup');
      await wrapper.get('textarea').setValue('Preserve the original files.');
      await save();
      expect(respond.mock.calls[0]![0].draft.comments).toEqual([expect.objectContaining({ sectionId: 's0', quote: 'Keep existing data.', body: 'Preserve the original files.' })]);
    } finally { wrapper.unmount(); }
  });
});
