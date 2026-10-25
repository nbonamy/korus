import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import PullRequestCleanupDialog from '../PullRequestCleanupDialog.vue';

const agent: Agent = {
  id: 'agent-pr',
  name: 'PR agent',
  folder: '/repo-worktree',
  backend: 'codex',
  status: { type: 'idle' },
  pullRequest: {
    provider: 'github',
    repository: 'owner/repo',
    branch: 'feat/pr',
    number: 7,
    title: 'Ship it',
    url: 'https://github.com/owner/repo/pull/7',
    draft: false,
    headSha: 'abc123',
    state: 'merged',
    mergedAt: '2026-09-03T12:00:00.000Z',
    createdAt: '2026-09-03T11:00:00.000Z',
    updatedAt: '2026-09-03T12:00:00.000Z',
  },
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
};

describe('PullRequestCleanupDialog', () => {
  it.each(['github', 'gitlab'] as const)('explains %s cleanup and emits the chosen action', async provider => {
    const requestAgent = { ...agent, pullRequest: { ...agent.pullRequest!, provider } };
    const reference = provider === 'gitlab' ? 'MR !7' : 'PR #7';
    const wrapper = mount(PullRequestCleanupDialog, {
      props: { agent: requestAgent, visible: true },
      global: {
        stubs: {
          ElDialog: {
            props: ['modelValue'],
            template: '<section v-if="modelValue"><slot name="header" /><slot /><slot name="footer" /></section>',
          },
        },
      },
    });

    expect(wrapper.text()).toContain(`${reference} was merged`);
    expect(wrapper.text()).toContain('close this agent and remove its worktree and local branch');

    await wrapper.get('.app-button--tertiary').trigger('click');
    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
    expect(wrapper.emitted('confirm')).toStrictEqual([[]]);

    await wrapper.setProps({ agent: { ...requestAgent, pullRequest: { ...requestAgent.pullRequest!, state: 'closed', mergedAt: undefined } } });
    expect(wrapper.text()).toContain(`${reference} was closed`);
    expect(wrapper.text()).toContain(provider === 'gitlab' ? 'This MR was not merged' : 'This PR was not merged');
    expect(wrapper.text()).toContain('remote branch will be kept');
  });
});
