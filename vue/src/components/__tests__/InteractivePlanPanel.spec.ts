import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { InteractivePlan } from '@workspace/core/interactive-plan';
import { applyAppTheme } from '../../theme/apply-theme';
import { defaultThemeSettings } from '@workspace/core/settings';
import InteractivePlanPanel from '../InteractivePlanPanel.vue';

function plan(): InteractivePlan {
  return {
    agentId: 'owner',
    conversationId: 'thread',
    id: 'plan',
    revision: 1,
    answerVersion: 0,
    submitted: false,
    history: [],
    answers: { choices: {}, comments: {} },
    document: {
      title: 'Scheduling messages',
      sections: [
        {
          id: 'schedule',
          claim: 'Users schedule messages.',
          decision: {
            question: 'Where?',
            options: [
              { id: 'folder', label: 'Folder' },
              { id: 'inline', label: 'Inline' },
            ],
            proposed: 'folder',
          },
        },
      ],
    },
  };
}
function message(
  wrapper: ReturnType<typeof mount>,
  overrides: Record<string, unknown> = {},
  wrongSource = false,
) {
  const iframe = wrapper.get('iframe').element as HTMLIFrameElement;
  const nonce = new DOMParser()
    .parseFromString(iframe.srcdoc, 'text/html')
    .querySelector('script')!
    .getAttribute('nonce');
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'null',
      source: wrongSource ? window : iframe.contentWindow,
      data: {
        type: 'plan-answers',
        agentId: 'owner',
        conversationId: 'thread',
        planId: 'plan',
        revision: 1,
        nonce,
        answers: {
          choices: { schedule: 'inline' },
          comments: { schedule: 'Explain cancellation.' },
        },
        ...overrides,
      },
    }),
  );
}
async function finishSave() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await flushPromises();
}
describe('InteractivePlanPanel', () => {
  it('saves frame answers without a prompt and submits only through the explicit host control', async () => {
    const current = plan();
    const respond = vi.fn(async (response) => ({
      ...current,
      answers: response.answers,
      answerVersion: response.answerVersion + 1,
      submitted: response.action === 'submit',
    }));
    const wrapper = mount(InteractivePlanPanel, {
      props: { plan: current, respond },
      attachTo: document.body,
    });
    try {
      expect(wrapper.get('iframe').attributes('sandbox')).toBe('allow-scripts');
      expect(wrapper.findAll('button').map(button => button.text())).toStrictEqual(['Revise']);
      expect(wrapper.find('[aria-haspopup="menu"]').exists()).toBe(false);
      expect(respond).not.toHaveBeenCalled();
      message(wrapper);
      await finishSave();
      expect(respond).toHaveBeenCalledExactlyOnceWith({
        planId: 'plan',
        revision: 1,
        answerVersion: 0,
        action: 'save',
        answers: {
          choices: { schedule: 'inline' },
          comments: { schedule: 'Explain cancellation.' },
        },
      });
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Revise')!
        .trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith({
        planId: 'plan',
        revision: 1,
        answerVersion: 1,
        action: 'submit',
        answers: {
          choices: { schedule: 'inline' },
          comments: { schedule: 'Explain cancellation.' },
        },
      });
      expect(wrapper.text()).toContain('awaiting revision');
      expect(
        wrapper
          .findAll('button')
          .find((b) => b.text() === 'Revise')!
          .attributes('disabled'),
      ).toBeDefined();
    } finally {
      wrapper.unmount();
    }
  });
  it('keeps the frame document stable when a saved snapshot reapplies the same theme', async () => {
    const current = plan();
    const respond = vi.fn(async response => ({ ...current, answers: response.answers, answerVersion: 1 }));
    const rootAttributes = [...document.documentElement.attributes].map(attribute => [attribute.name, attribute.value]);
    applyAppTheme(defaultThemeSettings);
    const wrapper = mount(InteractivePlanPanel, { props: { plan: current, respond }, attachTo: document.body });
    try {
      await flushPromises();
      const frame = wrapper.get('iframe').element as HTMLIFrameElement;
      const originalDocument = frame.srcdoc;
      message(wrapper);
      await finishSave();
      await wrapper.setProps({ plan: await respond.mock.results[0]!.value });
      expect(frame.srcdoc).toBe(originalDocument);
      // App.vue reapplies the root theme when a new snapshot arrives.
      applyAppTheme({ ...defaultThemeSettings });
      await flushPromises();
      expect(frame.srcdoc).toBe(originalDocument);
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
      applyAppTheme({ ...defaultThemeSettings, mode: 'dark', id: 'app-dark' });
      await flushPromises();
      expect(frame.srcdoc).not.toBe(originalDocument);
      await wrapper.setProps({ plan: { ...current, revision: 2 } });
      expect(wrapper.get('iframe').element).not.toBe(frame);
    } finally {
      wrapper.unmount();
      for (const attribute of [...document.documentElement.attributes]) document.documentElement.removeAttribute(attribute.name);
      for (const [name, value] of rootAttributes) document.documentElement.setAttribute(name!, value!);
    }
  });
  it('rejects foreign frames, wrong ownership, stale revisions, arbitrary commands and invalid choices', async () => {
    const respond = vi.fn();
    const wrapper = mount(InteractivePlanPanel, {
      props: { plan: plan(), respond },
      attachTo: document.body,
    });
    try {
      message(wrapper, {}, true);
      for (const payload of [
        { agentId: 'other' },
        { conversationId: 'other-thread' },
        { revision: 2 },
        { nonce: 'wrong' },
        { type: 'submit' },
        { rpc: 'execute' },
        { answers: { choices: { schedule: 'unknown' }, comments: {} } },
      ])
        message(wrapper, payload);
      await finishSave();
      expect(respond).not.toHaveBeenCalled();
      await wrapper.get('button').trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'submit', answers: { choices: {}, comments: {} } }));
    } finally {
      wrapper.unmount();
    }
  });
  it('keeps edits after save failure and retries before submitting, preserving backend version conflicts', async () => {
    const current = plan();
    const respond = vi
      .fn()
      .mockRejectedValueOnce(new Error('another window'))
      .mockImplementation(async (response) => ({
        ...current,
        answers: response.answers,
        answerVersion: response.answerVersion + 1,
      }));
    const wrapper = mount(InteractivePlanPanel, {
      props: { plan: current, respond },
      attachTo: document.body,
    });
    try {
      message(wrapper);
      await finishSave();
      expect(wrapper.get('[role="alert"]').text()).toBe('another window');
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Revise')!
        .trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenCalledTimes(1);
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Retry save')!
        .trigger('click');
      await flushPromises();
      expect(respond).toHaveBeenLastCalledWith(
        expect.objectContaining({
          answerVersion: 0,
          action: 'save',
          answers: {
            choices: { schedule: 'inline' },
            comments: { schedule: 'Explain cancellation.' },
          },
        }),
      );
    } finally {
      wrapper.unmount();
    }
  });
});
