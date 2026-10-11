import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { InteractivePlan } from '@workspace/core/interactive-plan';
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
        .find((b) => b.text() === 'Submit feedback')!
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
          .find((b) => b.text() === 'Submit feedback')!
          .attributes('disabled'),
      ).toBeDefined();
    } finally {
      wrapper.unmount();
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
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Readable plan')!
        .trigger('click');
      expect(wrapper.get('pre').text()).toContain('Folder (proposed)');
      expect(wrapper.get('pre').text()).not.toContain('(selected)');
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
        .find((b) => b.text() === 'Submit feedback')!
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
