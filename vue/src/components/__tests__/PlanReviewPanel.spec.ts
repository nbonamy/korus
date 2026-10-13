import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
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
  it('keeps normal Markdown, offers checkbox/radio choices, and sends only edited groups through Revise', async () => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      expect(wrapper.get('h1').text()).toBe('Delivery plan');
      expect(wrapper.findAll('table')).toHaveLength(1);
      expect(wrapper.get('pre').text()).toContain('- ( ) Code example');
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(3);
      expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
      expect(respond).not.toHaveBeenCalled();
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeDefined();
      await wrapper.findAll('input[type="checkbox"]')[2]!.setValue();
      await wrapper.findAll('input[type="radio"]')[0]!.setValue();
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond.mock.calls.map(c => c[0].resolution)).toEqual(['save', 'revise']);
      expect(respond.mock.calls[0]![0].draft).toStrictEqual({ comments: [], choices: [
        { id: 's1-g0', quote: 'Platforms\nmacOS\nWindows\nLinux', selected: ['macOS', 'Linux'] },
        { id: 's2-g1', quote: 'Storage\nProject\nHome', selected: ['Project'] },
      ] });
      expect(respond).toHaveBeenLastCalledWith({ reviewId: current.id, resolution: 'revise', draftVersion: 1 });
      expect(button(wrapper, 'Approve').attributes('disabled')).toBeDefined();
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

  it('loads the proposed radio selection without submitting feedback and lets the user confirm it', async () => {
    const current = review();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      expect(wrapper.findAll('input[type="radio"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([false, true]);
      await save();
      expect(respond).not.toHaveBeenCalled();
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeDefined();
      await wrapper.findAll('input[type="radio"]')[1]!.trigger('click');
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond.mock.calls[0]![0].draft.choices[0].selected).toEqual(['Home']);
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
      await wrapper.findAll('input[type="checkbox"]')[1]!.setValue();
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
    const wrapper = mount(PlanReviewPanel, { props: { review: current, respond } });
    try {
      expect(wrapper.get('.comment-preview').text()).toBe('Keep all platforms.');
      expect((wrapper.findAll('input[type="radio"]')[0]!.element as HTMLInputElement).checked).toBe(true);
      const reset = wrapper.get('button[aria-label="Clear choice"]');
      expect(reset.text()).toBe('');
      expect(reset.attributes('title')).toBe('Clear choice');
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
