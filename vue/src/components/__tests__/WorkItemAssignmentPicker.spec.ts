import { mount } from '@vue/test-utils';
import { computed } from 'vue';
import { backendChoicesKey } from '../backend-selection';
import { describe, expect, it, vi } from 'vitest';
import { codeReviewSettingsKey } from '../code-review-settings';
import type { WorkItem } from '@workspace/core/contracts';
import WorkItemAssignmentPicker from '../WorkItemAssignmentPicker.vue';

const issue: WorkItem = {
  provider: 'github',
  id: 'github:nbonamy/agent-workspace#24',
  sourceId: 'nbonamy/agent-workspace',
  sourceName: 'nbonamy/agent-workspace',
  number: 24,
  title: 'Repository-first sessions',
  url: 'https://github.com/nbonamy/agent-workspace/issues/24',
  state: 'open',
  kind: 'issue',
  labels: [],
  assignees: [],
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('WorkItemAssignmentPicker', () => {
  it('lets a new agent start with a chosen backend, model and reasoning effort', async () => {
    const listModels = vi.fn(async () => [
      { id: 'm1', model: 'gpt-fast', displayName: 'GPT Fast', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] },
      { id: 'm2', model: 'hidden', displayName: 'Hidden', hidden: true },
    ]);
    const wrapper = mount(WorkItemAssignmentPicker, {
      props: { item: issue, branchName: 'fix/gh-24', modelAgentId: 'agent-main' },
      slots: { default: '<p class="issue-body">Issue body</p>' },
      global: { provide: {
        [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']),
        [codeReviewSettingsKey as symbol]: { preferences: () => undefined, listModels, switchToManual: vi.fn(), stop: vi.fn() },
      } },
    });
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledWith('agent-main', 'codex'));
    await vi.waitFor(() => expect(wrapper.find('.work-item-assignment-picker__model-selectors').text()).toContain('GPT Fast'));
    expect(wrapper.get('.work-item-assignment-picker__model-selectors').text()).not.toContain('Hidden');

    const html = wrapper.html();
    expect(html.indexOf('work-item-assignment-picker__target-options')).toBeLessThan(html.indexOf('issue-body'));
    expect(html.indexOf('issue-body')).toBeLessThan(html.indexOf('app-button--primary'));

    const selects = wrapper.findAll('.work-item-assignment-picker__model-selectors select');
    await selects[1]!.setValue('gpt-fast');
    await selects[2]!.setValue('high');
    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('submit')).toStrictEqual([[
      { action: 'fix', destination: 'new', item: issue, backend: 'codex', model: 'gpt-fast', reasoningEffort: 'high' },
    ]]);
  });

  it('defaults to an isolated session and emits the tuned primary action', async () => {
    const wrapper = mount(WorkItemAssignmentPicker, {
      props: {
        item: issue,
        branchName: 'fix/gh-24',
        sessions: [{ agentId: 'agent-main', label: 'main · main' }],
      },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });

    const destinationButtons = wrapper.findAll('.work-item-assignment-picker__target-options button');
    expect(destinationButtons[0]!.text()).toContain('New agent');
    expect(destinationButtons[0]!.text()).toContain('Create an agent in a dedicated worktree.');
    expect(destinationButtons[0]!.classes()).toContain('is-selected');
    expect(destinationButtons[0]!.attributes('aria-pressed')).toBe('true');
    expect(destinationButtons[1]!.text()).toContain('Existing agent');
    expect(destinationButtons[1]!.attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('input[aria-label="Branch"]').attributes('readonly')).toBeDefined();
    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('fix/gh-24');
    expect(wrapper.text()).not.toContain('Workspace');
    expect(wrapper.get('.work-item-assignment-picker__branch-warning').classes()).toContain('is-hidden');
    expect(wrapper.text()).not.toContain('New worktree');
    await wrapper.get('.backend-selector select').setValue('claude');
    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('submit')).toStrictEqual([[
      { action: 'fix', destination: 'new', item: issue, backend: 'claude' },
    ]]);
    await destinationButtons[1]!.trigger('click');
    expect(wrapper.find('.backend-selector').exists()).toBe(false);
  });

  it('assigns an existing repository session without offering a worktree', async () => {
    const wrapper = mount(WorkItemAssignmentPicker, {
      props: {
        item: issue,
        branchName: 'fix/gh-24',
        sessions: [{ agentId: 'agent-main', branch: 'feature/current', label: 'main · feature/current' }],
      },
    });

    await wrapper.findAll('.work-item-assignment-picker__target-options button')[1]!.trigger('click');
    expect(wrapper.findAll('.work-item-assignment-picker__target-options button')[1]!.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('main · feature/current');
    expect(wrapper.text()).toContain('Continue in an agent’s current branch.');
    expect(wrapper.text()).toContain('The agent will work in its current branch. No branch or worktree will be created.');
    expect(wrapper.get('.work-item-assignment-picker__branch-warning').classes()).not.toContain('is-hidden');
    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('feature/current');
    await wrapper.get('.app-button--secondary').trigger('click');

    expect(wrapper.emitted('submit')).toStrictEqual([[
      { action: 'investigate', agentId: 'agent-main', destination: 'existing', item: issue },
    ]]);
  });

  it('disables existing-session assignment when the repository has no session', () => {
    const wrapper = mount(WorkItemAssignmentPicker, {
      props: { item: issue, branchName: 'fix/gh-24' },
    });

    const existingButton = wrapper.findAll('.work-item-assignment-picker__target-options button')[1]!;
    expect(existingButton.attributes('disabled')).toBeDefined();
    expect(existingButton.text()).toContain('No agents are available in this repository');
  });

  it('offers a pull request only to agents already on its head branch', async () => {
    const pullRequest: WorkItem = { ...issue, kind: 'pullRequest', branchName: 'feature/pr-7' };
    const sessions = [
      { agentId: 'agent-main', branch: 'main', label: 'main · main' },
      { agentId: 'agent-pr', branch: 'feature/pr-7', label: 'pr · feature/pr-7' },
    ];
    const wrapper = mount(WorkItemAssignmentPicker, { props: { item: pullRequest, branchName: 'feature/pr-7', sessions } });

    await wrapper.findAll('.work-item-assignment-picker__target-options button')[1]!.trigger('click');
    expect(wrapper.text()).toContain('pr · feature/pr-7');
    expect(wrapper.text()).not.toContain('main · main');
    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('submit')![0]![0]).toMatchObject({ action: 'review', agentId: 'agent-pr', destination: 'existing' });

    const none = mount(WorkItemAssignmentPicker, { props: { item: pullRequest, branchName: 'feature/pr-7', sessions: [sessions[0]!] } });
    const existing = none.findAll('.work-item-assignment-picker__target-options button')[1]!;
    expect(existing.attributes('disabled')).toBeDefined();
    expect(existing.text()).toContain('No agent is on this pull request’s branch');
  });

  it('asks before reusing an existing worktree', async () => {
    const wrapper = mount(WorkItemAssignmentPicker, {
      props: {
        item: issue,
        branchName: 'fix/gh-24',
        existingWorktreePath: '/Users/nbonamy/src/agent-workspace-fix-gh-24',
      },
    });

    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('Worktree already exists');
    expect(wrapper.text()).toContain('fix/gh-24 is already checked out at:');
    expect(wrapper.text()).toContain('/Users/nbonamy/src/agent-workspace-fix-gh-24');

    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('submit')).toStrictEqual([[
      { action: 'fix', destination: 'new', item: issue, reuseExisting: true, backend: 'codex' },
    ]]);
  });
});
