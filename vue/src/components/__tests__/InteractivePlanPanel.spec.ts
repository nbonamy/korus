import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { InteractivePlan, InteractivePlanResponse } from '@workspace/core/interactive-plan';
import { applyAppTheme } from '../../theme/apply-theme';
import { defaultThemeSettings } from '@workspace/core/settings';
import InteractivePlanPanel from '../InteractivePlanPanel.vue';

function plan(): InteractivePlan {
  return {
    agentId: 'owner', conversationId: 'thread', id: 'plan', revision: 1,
    answerVersion: 0, submitted: false, history: [], answers: { choices: {}, comments: {} },
    document: { title: 'Scheduling messages', sections: [{
      id: 'schedule', claim: 'Users schedule messages.',
      decision: { question: 'Where?', options: [{ id: 'folder', label: 'Folder' }, { id: 'inline', label: 'Inline' }], proposed: 'folder' },
      children: [{ id: 'cancel', claim: 'Users can cancel before delivery.', detail: 'Keep the original draft.' }],
    }] },
  };
}
const result = (current: InteractivePlan, response: InteractivePlanResponse): InteractivePlan => ({
  ...current, answers: response.answers, answerVersion: response.answerVersion + 1, submitted: response.action === 'submit',
});
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(button => button.text() === text)!;
async function finishSave() {
  await new Promise(resolve => setTimeout(resolve, 400));
  await flushPromises();
}

describe('InteractivePlanPanel', () => {
  it('keeps footer actions stable during typing and background saves, then waits for the latest save before approval', async () => {
    const current = plan();
    let completeSave!: () => void;
    const respond = vi.fn((response: InteractivePlanResponse) => new Promise<InteractivePlan>(resolve => {
      completeSave = () => resolve(result(current, response));
    }));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond, nativeApprovalAvailable: true }, attachTo: document.body });
    try {
      const footer = wrapper.get('footer');
      const actions = footer.findAll('button');
      await wrapper.get('button[aria-label="Comment on this section: Users schedule messages."]').trigger('click');
      const editor = wrapper.get('textarea');
      for (const text of ['A', 'AB']) {
        await editor.setValue(text);
        await finishSave();
        expect(footer.findAll('button').map(action => action.element)).toEqual(actions.map(action => action.element));
        expect(actions.every(action => !(action.element as HTMLButtonElement).disabled)).toBe(true);
        expect(footer.find('[role="status"]').exists()).toBe(false);
        completeSave();
        await flushPromises();
        expect(actions.every(action => !(action.element as HTMLButtonElement).disabled)).toBe(true);
      }
      await editor.setValue('ABC');
      await button(wrapper, 'Approve').trigger('click');
      expect(wrapper.emitted('confirmPlan')).toBeUndefined();
      expect(button(wrapper, 'Approve').attributes('disabled')).toBeDefined();
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'save', answerVersion: 2, answers: { choices: {}, comments: { schedule: 'ABC' } } }));
      completeSave();
      await flushPromises();
      expect(wrapper.emitted('confirmPlan')).toHaveLength(1);
    } finally { completeSave?.(); wrapper.unmount(); }
  });

  it.each(['failed save', 'different revision'])('does not approve after a %s while waiting for edits to save', async outcome => {
    const current = plan();
    let completeSave!: () => void;
    const respond = vi.fn((response: InteractivePlanResponse) => new Promise<InteractivePlan>((resolve, reject) => {
      completeSave = () => outcome === 'failed save' ? reject(new Error('Save failed')) : resolve(result(current, response));
    }));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond, nativeApprovalAvailable: true } });
    try {
      await wrapper.get('input[value="inline"]').setValue();
      await button(wrapper, 'Approve').trigger('click');
      expect(respond).toHaveBeenCalledOnce();
      if (outcome === 'different revision') await wrapper.setProps({ plan: { ...plan(), revision: 2 } });
      completeSave();
      await flushPromises();
      expect(wrapper.emitted('confirmPlan')).toBeUndefined();
      if (outcome === 'failed save') expect(wrapper.get('[role="alert"]').text()).toBe('Save failed');
    } finally { completeSave?.(); wrapper.unmount(); }
  });

  it('edits native choices and comments, saves silently, and submits only with Revise', async () => {
    const current = plan();
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond }, attachTo: document.body });
    try {
      expect(wrapper.get('h1').text()).toBe(current.document.title);
      expect(wrapper.find('iframe').exists()).toBe(false);
      expect(wrapper.findAll('input:checked')).toHaveLength(0);
      expect(respond).not.toHaveBeenCalled();
      await wrapper.get('input[value="inline"]').setValue();
      const toggle = wrapper.get('button[aria-label="Comment on this section: Users schedule messages."]');
      await toggle.trigger('click');
      const editor = wrapper.get('textarea');
      expect(editor.isVisible()).toBe(true);
      expect(document.activeElement).toBe(editor.element);
      await editor.setValue('Explain cancellation.');
      await toggle.trigger('click');
      expect(editor.isVisible()).toBe(false);
      expect(wrapper.get('.comment-preview').text()).toBe('Explain cancellation.');
      await finishSave();
      expect(respond).toHaveBeenCalledExactlyOnceWith({ planId: 'plan', revision: 1, answerVersion: 0, action: 'save', answers: { choices: { schedule: 'inline' }, comments: { schedule: 'Explain cancellation.' } } });
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith({ planId: 'plan', revision: 1, answerVersion: 1, action: 'submit', answers: { choices: { schedule: 'inline' }, comments: { schedule: 'Explain cancellation.' } } });
      expect(wrapper.text()).toContain('awaiting revision');
      expect(wrapper.get('input').attributes('disabled')).toBeDefined();
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it('preserves section, editor and DOM state through saved snapshots and theme changes', async () => {
    const current = plan();
    const respond = vi.fn(async response => result(current, response));
    const rootAttributes = [...document.documentElement.attributes].map(attribute => [attribute.name, attribute.value]);
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond }, attachTo: document.body });
    try {
      const child = wrapper.findAll('details')[1]!;
      (child.get('summary').element as HTMLElement).click();
      await flushPromises();
      expect((child.element as HTMLDetailsElement).open).toBe(true);
      await wrapper.get('button[aria-label="Comment on this section: Users schedule messages."]').trigger('click');
      const editor = wrapper.get('textarea');
      await editor.setValue('Keep my position.');
      await wrapper.get('input[value="inline"]').setValue();
      await finishSave();
      await wrapper.setProps({ plan: await respond.mock.results[0]!.value });
      applyAppTheme({ ...defaultThemeSettings, mode: 'dark', id: 'app-dark' });
      await flushPromises();
      expect(wrapper.get('textarea').element).toBe(editor.element);
      expect(editor.isVisible()).toBe(true);
      expect((editor.element as HTMLTextAreaElement).value).toBe('Keep my position.');
      expect((child.element as HTMLDetailsElement).open).toBe(true);
      await editor.trigger('keydown', { key: 'Escape' });
      expect(editor.isVisible()).toBe(false);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Comment on this section: Users schedule messages.');
      await button(wrapper, 'Clear choice').trigger('click');
      await finishSave();
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'save', answerVersion: 1, answers: { choices: {}, comments: { schedule: 'Keep my position.' } } }));
    } finally {
      wrapper.unmount();
      for (const attribute of [...document.documentElement.attributes]) document.documentElement.removeAttribute(attribute.name);
      for (const [name, value] of rootAttributes) document.documentElement.setAttribute(name!, value!);
    }
  });

  it.each(['revision', 'owner'])('isolates pending saves when the %s changes', async change => {
    const current = plan();
    let resolveOld!: (plan: InteractivePlan) => void;
    const oldRespond = vi.fn(() => new Promise<InteractivePlan>(resolve => { resolveOld = resolve; }));
    const next = change === 'revision' ? { ...plan(), revision: 2 } : { ...plan(), agentId: 'other', conversationId: 'other-thread' };
    const newRespond = vi.fn(async response => result(next, response));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond: oldRespond }, attachTo: document.body });
    try {
      await wrapper.get('input[value="inline"]').setValue();
      await finishSave();
      expect(oldRespond).toHaveBeenCalledOnce();
      await wrapper.setProps({ plan: next, respond: newRespond });
      expect(wrapper.findAll('input:checked')).toHaveLength(0);
      resolveOld({ ...current, answerVersion: 9, submitted: true });
      await flushPromises();
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      await wrapper.get('input[value="folder"]').setValue();
      await finishSave();
      expect(newRespond).toHaveBeenCalledExactlyOnceWith({ planId: next.id, revision: next.revision, answerVersion: 0, action: 'save', answers: { choices: { schedule: 'folder' }, comments: {} } });
    } finally { wrapper.unmount(); }
  });

  it('keeps edits after save failure and retries before submitting with the current version', async () => {
    const current = plan();
    const respond = vi.fn().mockRejectedValueOnce(new Error('another window')).mockImplementation(async response => result(current, response));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond }, attachTo: document.body });
    try {
      await wrapper.get('input[value="inline"]').setValue();
      await finishSave();
      expect(wrapper.get('[role="alert"]').text()).toBe('another window');
      expect((wrapper.get('input[value="inline"]').element as HTMLInputElement).checked).toBe(true);
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenCalledTimes(1);
      await button(wrapper, 'Retry save').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ answerVersion: 0, action: 'save', answers: { choices: { schedule: 'inline' }, comments: {} } }));
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('keeps repeated option ids independent across sections', async () => {
    const current = plan();
    current.document.sections.push({ ...current.document.sections[0]!, id: 'delivery', claim: 'Choose delivery.', children: undefined });
    const respond = vi.fn(async response => result(current, response));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond }, attachTo: document.body });
    try {
      const groups = wrapper.findAll('.decision');
      (groups[0]!.get('input[value="folder"]').element as HTMLInputElement).click();
      (groups[1]!.get('input[value="inline"]').element as HTMLInputElement).click();
      await finishSave();
      expect(wrapper.findAll('input:checked').map(input => (input.element as HTMLInputElement).value)).toEqual(['folder', 'inline']);
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ answers: { choices: { schedule: 'folder', delivery: 'inline' }, comments: {} } }));
    } finally { wrapper.unmount(); }
  });

  it('allows retrying a failed explicit submission without losing saved answers', async () => {
    const current = plan();
    const respond = vi.fn().mockImplementationOnce(async response => result(current, response))
      .mockRejectedValueOnce(new Error('Unable to deliver feedback'))
      .mockImplementation(async response => result(current, response));
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond } });
    try {
      await wrapper.get('input[value="inline"]').setValue();
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBe('Unable to deliver feedback');
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeUndefined();
      await button(wrapper, 'Revise').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenCalledTimes(3);
      expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'submit', answerVersion: 1, answers: { choices: { schedule: 'inline' }, comments: {} } }));
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it('does not submit feedback after navigating away while Revise waits for a save', async () => {
    const current = plan();
    let resolveSave!: (value: InteractivePlan) => void;
    const respond = vi.fn(() => new Promise<InteractivePlan>(resolve => { resolveSave = resolve; }));
    const nextRespond = vi.fn();
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond } });
    try {
      await wrapper.get('input[value="inline"]').setValue();
      await button(wrapper, 'Revise').trigger('click');
      expect(respond).toHaveBeenCalledOnce();
      await wrapper.setProps({ plan: { ...plan(), revision: 2 }, respond: nextRespond });
      resolveSave({ ...current, answerVersion: 1 });
      await flushPromises();
      expect(respond).toHaveBeenCalledOnce();
      expect(nextRespond).not.toHaveBeenCalled();
      expect(button(wrapper, 'Revise').attributes('disabled')).toBeUndefined();
    } finally { wrapper.unmount(); }
  });

  it('renders hostile plan, mockup and comment values as inert text', () => {
    const hostile = '</textarea><script>window.bad=true</script><img src="https://attacker.test" onerror="run()">';
    const current = plan();
    current.document.title = hostile;
    current.document.sections[0]!.claim = hostile;
    current.document.sections[0]!.exhibit = { title: hostile, text: hostile, screens: [{ label: hostile, title: hostile, navigation: [hostile], content: [hostile], fields: [{ label: hostile, value: hostile }], items: [{ title: hostile, detail: hostile }], actions: [hostile] }] };
    current.document.sections[0]!.children![0]!.exhibit = { title: 'Code', text: hostile };
    current.answers.comments.schedule = hostile;
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current } });
    try {
      expect(wrapper.get('h1').text()).toBe(hostile);
      expect(wrapper.get('.comment-preview').text()).toBe(hostile);
      expect(wrapper.get('.mockup-field > div').text()).toBe(hostile);
      expect(wrapper.get('pre').text()).toBe(hostile);
      expect(wrapper.find('script,img,a,iframe,form,[onclick],[onerror]').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });
});
