import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, WorkItem } from '@workspace/core/contracts';
import RepositoryBacklogPanel from '../RepositoryBacklogPanel.vue';
import { createClientApiMock } from '../../test/client-api-mock';
import { appApi, configureAppClient } from '../../platform-api';
import { backlogConnectionsKey } from '../backlog-providers';

describe('RepositoryBacklogPanel', () => {
  it('browses GitLab MR details and assigns the native ! reference', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    const source = { provider: 'gitlab' as const, id: 'gitlab.com/group/sub/repo', name: 'repo', fullName: 'group/sub/repo', url: 'https://gitlab.com/group/sub/repo' };
    const mr = workItem({ provider: 'gitlab', id: `${source.id}!12`, sourceId: source.id, sourceName: source.fullName, kind: 'pullRequest', identifier: '!12', branchName: 'topic', body: 'Review this patch', url: `${source.url}/-/merge_requests/12` });
    api.listWorkSources.mockResolvedValue([source]);
    api.listWorkItems.mockResolvedValue([mr]);
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(RepositoryBacklogPanel, { props: { agent, agents: [agent], assignments: {}, visible: true, repositoryId: source.id, startWorkAction }, global: { stubs: { teleport: true }, provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }] } } });
    await flushPromises();
    const tab = wrapper.findAll('[role="radio"]').find(button => button.text() === 'Merge requests')!;
    expect(tab).toBeTruthy();
    await tab.trigger('click');
    expect(wrapper.text()).toContain('!12');
    expect(wrapper.get('.repository-backlog__item-actions').attributes('aria-label')).toContain('!12');
    expect(wrapper.get('.repository-backlog__item-title').attributes('href')).toBe(mr.url);
    await wrapper.get('.repository-backlog__item-actions').trigger('click');
    expect(wrapper.get('.work-item-detail').text()).toContain('Review this patch');
    await wrapper.get('.work-item-assignment-picker .app-button--primary').trigger('click');
    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ item: mr, action: 'review' }));
    wrapper.unmount(); configureAppClient();
  });
  it('shows native Linear details, filters by the viewer and resets details when the source changes', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    api.listWorkSources.mockResolvedValue(['a', 'b'].map(id => ({ provider: 'linear', id: `linear:${id}`, owner: id, name: id, fullName: id, url: 'https://linear.app', isPrivate: true })));
    const item = workItem({ provider: 'linear', id: 'linear:issue', sourceId: 'linear:a', identifier: 'ENG-12', nativeState: 'Started', body: 'Repair login', assignedToViewer: true, assignees: ['Alex'] });
    api.listWorkItems.mockResolvedValue([item]);
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({ startWorkAction });
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    await wrapper.get('[aria-label="Team / project"] select').setValue('linear:a');
    await flushPromises();
    expect(wrapper.text()).toContain('ENG-12');
    expect(wrapper.text()).toContain('Started');
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(1);
    await wrapper.get('.repository-backlog__item-actions').trigger('click');
    expect(wrapper.get('.work-item-detail').text()).toContain('Repair login');
    await wrapper.get('.work-item-assignment-picker .app-button--primary').trigger('click');
    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ item, target: 'duplicate', action: 'fix', workspace: { kind: 'worktree', branchName: 'fix/eng-12' } }));
    const guard = startWorkAction.mock.calls[0]![0].isCurrent;
    await wrapper.get('[aria-label="Team / project"] select').setValue('linear:b');
    await flushPromises();
    expect(wrapper.find('.work-item-detail').exists()).toBe(false);
    expect(guard()).toBe(false);
    await wrapper.get('[aria-label="Team / project"] select').setValue('linear:a');
    await flushPromises();
    await wrapper.get('.repository-backlog__item-actions').trigger('click');
    expect(guard()).toBe(false);
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('github');
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(2);
    configureAppClient();
  });
  beforeEach(() => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    window.localStorage.clear();
  });

  it('separates issues and pull requests and filters the visible list', async () => {
    const wrapper = await mountPanel({
      items: [
        workItem(),
        workItem({ id: 'nbonamy/agent-workspace#21', kind: 'pullRequest', number: 21, title: 'Ship backlog workspace' }),
      ],
    });

    expect(wrapper.findComponent({ name: 'GitHubIcon' }).exists()).toBe(true);

    expect(wrapper.findAll('.repository-backlog__segments button svg')).toHaveLength(2);
    expect(wrapper.text()).toContain('Fix backlog assignment');
    expect(wrapper.text()).not.toContain('Ship backlog workspace');

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click');

    expect(wrapper.text()).not.toContain('Fix backlog assignment');
    expect(wrapper.text()).toContain('Ship backlog workspace');
  });

  it('opens issue and pull request titles in the system browser without adding another row action', async () => {
    const wrapper = await mountPanel({
      items: [
        workItem(),
        workItem({
          id: 'nbonamy/agent-workspace#21',
          kind: 'pullRequest',
          number: 21,
          title: 'Ship backlog workspace',
          url: 'https://github.com/nbonamy/agent-workspace/pull/21',
        }),
      ],
    });

    const issueLink = wrapper.get('.repository-backlog__item-title');
    expect(issueLink.attributes()).toMatchObject({
      href: 'https://github.com/nbonamy/agent-workspace/issues/12',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(wrapper.findAll('[aria-label^="Work item actions"]')).toHaveLength(1);

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click');

    const pullRequestLink = wrapper.get('.repository-backlog__item-title');
    expect(pullRequestLink.attributes('href')).toBe('https://github.com/nbonamy/agent-workspace/pull/21');
    expect(wrapper.findAll('[aria-label^="Work item actions"]')).toHaveLength(1);
  });

  it('darkens pale label text while preserving the source color for its tint', async () => {
    const wrapper = await mountPanel({
      items: [workItem({ labels: [{ name: 'enhancement', color: 'a2eeef' }] })],
    });

    const label = wrapper.get('.repository-backlog__label');
    expect(label.attributes('style')).toContain('--repository-label-color: #a2eeef');
    expect(label.attributes('style')).toContain('--repository-label-text-color: #547c7c');
  });

  it('groups assigned work by lifecycle status', async () => {
    const wrapper = await mountPanel({
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: agent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'review',
          status: 'completed',
        },
      },
    });

    expect(wrapper.text()).toContain('Completed');
    expect(wrapper.text()).toContain('Fix backlog assignment');
  });

  it('replaces default item metadata with a wrapping multi-line agent comment', async () => {
    const note = 'Investigation complete: the reconnect race happens after restart.\nThe backend response arrives after the client closes.';
    const wrapper = await mountPanel({
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: agent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'review',
          status: 'blocked',
          note,
        },
      },
    });

    const row = wrapper.get('.repository-backlog__item');
    expect(row.classes()).toContain('repository-backlog__item--commented');
    expect(row.find('.repository-backlog__item-meta').exists()).toBe(false);
    expect(row.get('.repository-backlog__assignment-note').element.textContent).toBe(note);
    expect(row.get('.repository-backlog__assignment-note').attributes('title')).toBeUndefined();
    expect(row.find('.repository-backlog__label').exists()).toBe(false);
  });

  it('replaces start-work choices with assigned-item actions', async () => {
    const clearAssignmentAction = vi.fn();
    const showAgentAction = vi.fn();
    const otherAgent = { ...agent, id: 'agent-jesse', name: 'Jesse' };
    const wrapper = await mountPanel({
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: otherAgent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'review',
          status: 'blocked',
          note: 'Need repository access',
        },
      },
      clearAssignmentAction,
      showAgentAction,
    });

    expect(wrapper.text()).toContain('Blocked');
    expect(wrapper.text()).toContain('Need repository access');
    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    expect(wrapper.text()).not.toContain('Assigned to Jesse');
    expect(wrapper.text()).toContain('Show agent');
    expect(wrapper.text()).toContain('Clear assignment');
    expect(wrapper.text()).not.toContain('Use current agent');
    expect(wrapper.get('.repository-backlog__assignment-menu').attributes('role')).toBe('menu');
    expect(wrapper.find('.repository-backlog__assignment-close').exists()).toBe(false);

    await wrapper.findAll('.repository-backlog__assignment-menu [role="menuitem"]')[0]!.trigger('click');
    expect(showAgentAction).toHaveBeenCalledWith(otherAgent.id);

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.findAll('.repository-backlog__assignment-menu [role="menuitem"]')[1]!.trigger('click');
    expect(clearAssignmentAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'nbonamy/agent-workspace#12' }));
  });

  it('opens an assigned item owner from the row without intercepting its GitHub link or actions menu', async () => {
    const showAgentAction = vi.fn();
    const otherAgent = { ...agent, id: 'agent-jesse', name: 'Jesse' };
    const wrapper = await mountPanel({
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: otherAgent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'review',
          status: 'inProgress',
        },
      },
      showAgentAction,
    });

    const row = wrapper.get('.repository-backlog__item');
    expect(row.classes()).toContain('repository-backlog__item--assigned');
    await row.trigger('click');
    expect(showAgentAction).toHaveBeenCalledWith(otherAgent.id);

    showAgentAction.mockClear();
    await wrapper.get('.repository-backlog__item-title').trigger('click');
    expect(showAgentAction).not.toHaveBeenCalled();

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    expect(showAgentAction).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Show agent');
  });

  it('keeps the assigned-agent action visible but disabled for the current agent', async () => {
    const showAgentAction = vi.fn();
    const wrapper = await mountPanel({
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: agent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'complete',
          status: 'inProgress',
        },
      },
      showAgentAction,
    });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');

    const actions = wrapper.findAll('.repository-backlog__assignment-menu [role="menuitem"]');
    expect(actions).toHaveLength(2);
    expect(actions[0]!.text()).toBe('Assigned to current agent');
    expect(actions[0]!.attributes('disabled')).toBeDefined();
    expect(actions[1]!.text()).toBe('Clear assignment');
    expect(wrapper.get('.repository-backlog__assignment-menu').attributes('role')).toBe('menu');
    expect(wrapper.find('.repository-backlog__assignment-close').exists()).toBe(false);
    expect(wrapper.find('.repository-backlog__assignment-header').exists()).toBe(false);
    await actions[0]!.trigger('click');
    expect(showAgentAction).not.toHaveBeenCalled();
  });

  it('asks whether to close an existing assigned agent before clearing its assignment', async () => {
    const clearAssignmentAction = vi.fn();
    const closeAgentAction = vi.fn();
    const otherAgent = { ...agent, id: 'agent-jesse', name: 'Jesse' };
    const wrapper = await mountPanel({
      agents: [agent, otherAgent],
      assignments: {
        'github:nbonamy/agent-workspace#12': {
          provider: 'github',
          itemId: 'nbonamy/agent-workspace#12',
          agentId: otherAgent.id,
          assignedAt: '2026-08-12T00:00:00.000Z',
          policy: 'review',
          status: 'inProgress',
        },
      },
      clearAssignmentAction,
      closeAgentAction,
    });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.findAll('.repository-backlog__assignment-menu [role="menuitem"]')[1]!.trigger('click');

    expect(wrapper.get('.repository-backlog__clear-dialog').text()).toContain('Do you want to close the assigned agent Jesse?');
    expect(clearAssignmentAction).not.toHaveBeenCalled();
    expect(closeAgentAction).not.toHaveBeenCalled();

    await wrapper.findAll('.repository-backlog__clear-dialog .app-button')[0]!.trigger('click');
    expect(clearAssignmentAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'nbonamy/agent-workspace#12' }));
    expect(closeAgentAction).not.toHaveBeenCalled();

    clearAssignmentAction.mockClear();
    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.findAll('.repository-backlog__assignment-menu [role="menuitem"]')[1]!.trigger('click');
    await wrapper.findAll('.repository-backlog__clear-dialog .app-button')[1]!.trigger('click');
    expect(clearAssignmentAction).not.toHaveBeenCalled();
    expect(closeAgentAction).toHaveBeenCalledWith(otherAgent.id);
  });

  it('keeps search collapsed until requested and clears it when closed', async () => {
    const wrapper = await mountPanel();

    expect(wrapper.find('[aria-label="Search repository work"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="Search repository work"]').exists()).toBe(false);

    await wrapper.get('button[aria-label="Search repository work"]').trigger('click');
    const search = wrapper.get('input[aria-label="Search repository work"]');

    await search.setValue('missing');
    expect(wrapper.text()).toContain('No matching work items');

    await wrapper.get('button[aria-label="Close search"]').trigger('click');
    expect(wrapper.find('input[aria-label="Search repository work"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Fix backlog assignment');
  });

  it('saves filter defaults for only the current repository', async () => {
    const wrapper = await mountPanel({
      items: [
        workItem(),
        workItem({ id: 'nbonamy/agent-workspace#13', number: 13, title: 'Completed backlog work', state: 'closed' }),
      ],
    });

    wrapper.findAllComponents({ name: 'ElPopover' })
      .find((popover) => popover.attributes('popper-class')?.includes('repository-backlog__filters-popover'))
      ?.vm.$emit('update:visible', true);
    await nextTick();
    await wrapper.get('[aria-label="Work item state"] select').setValue('closed');
    await nextTick();
    await wrapper.get('.repository-backlog__filter-menu footer button').trigger('click');

    expect(window.localStorage.getItem('repositoryBacklogFilters:github:undefined:nbonamy/agent-workspace')).toBe(JSON.stringify({
      state: 'closed',
      assignee: 'all',
      label: '',
    }));

    wrapper.unmount();
    const restored = await mountPanel({
      items: [
        workItem(),
        workItem({ id: 'nbonamy/agent-workspace#13', number: 13, title: 'Completed backlog work', state: 'closed' }),
      ],
    });
    expect(restored.text()).not.toContain('Fix backlog assignment');
    expect(restored.text()).toContain('Completed backlog work');

    const otherRepository = await mountPanel({ repositoryId: 'nbonamy/another-repository' });
    expect(otherRepository.text()).toContain('Fix backlog assignment');
  });

  it('ignores invalid or unavailable saved filter defaults', async () => {
    window.localStorage.setItem('repositoryBacklogFilters:github:undefined:nbonamy/agent-workspace', JSON.stringify({
      state: 'invalid',
      assignee: 'invalid',
      label: 'not-in-this-repository',
    }));

    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('Fix backlog assignment');
  });

  it('offers contextual issue actions and fixes an issue in an isolated worktree', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({ startWorkAction });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    expect(wrapper.text()).toContain('Start work on #12');
    expect(wrapper.text()).toContain('Custom');
    expect(wrapper.text()).toContain('Investigate');
    expect(wrapper.text()).toContain('Fix');
    expect(wrapper.text()).not.toContain('Cancel');
    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('fix/gh-12');
    expect(wrapper.findAll('.work-item-assignment-picker__target-options > button')[0]!.classes()).toContain('is-selected');

    await wrapper.get('.repository-backlog__start-work .app-button--primary').trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith({ action: 'fix', isCurrent: expect.any(Function), item: expect.objectContaining({ id: 'nbonamy/agent-workspace#12' }), target: 'duplicate', workspace: { branchName: 'fix/gh-12', kind: 'worktree' }, selection: { backend: 'codex', model: null, reasoningEffort: null, serviceTier: null } });
    await nextTick();
    expect(wrapper.text()).toContain('Work started');
  });

  it('keeps experimental issue creation out of the backlog toolbar', async () => {
    const wrapper = await mountPanel();

    expect(wrapper.find('[aria-label="Create issue"]').exists()).toBe(false);
    expect(wrapper.find('.repository-issue-composer').exists()).toBe(false);
  });

  it('prefills custom issue work without dispatching it', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({ startWorkAction });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.get('.repository-backlog__start-work .app-button--tertiary').trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'custom', item: expect.objectContaining({ id: 'nbonamy/agent-workspace#12' }), isCurrent: expect.any(Function) }));
  });

  it('dispatches issue investigation without using the fix prompt', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({ startWorkAction });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.findAll('.repository-backlog__start-work button').find(button => button.text() === 'Investigate')!.trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'investigate' }));
  });

  it('can dispatch work in the current session without creating a worktree', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({ branch: 'feature/current-work', startWorkAction });

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    expect(wrapper.text()).toContain('New agent');

    await wrapper.findAll('.work-item-assignment-picker__target-options > button')[1]!.trigger('click');
    expect(wrapper.findAll('.work-item-assignment-picker__target-options > button')[1]!.classes()).toContain('is-selected');
    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('feature/current-work');
    await wrapper.get('.repository-backlog__start-work .app-button--primary').trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({
      target: 'current',
      workspace: { kind: 'current' },
    }));
  });

  it('forces duplicated agents into a worktree and suggests a review branch for pull requests', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({
      items: [workItem({ branchName: 'feature/backlog-workspace', kind: 'pullRequest', number: 21, title: 'Ship backlog workspace' })],
      startWorkAction,
    });

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click');
    await wrapper.get('[aria-label="Work item actions #21"]').trigger('click');
    expect(wrapper.text()).toContain('Address feedback');
    expect(wrapper.text()).toContain('Review');
    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('feature/backlog-workspace');
    expect(wrapper.findAll('.work-item-assignment-picker__target-options > button')[0]!.classes()).toContain('is-selected');
    await wrapper.get('.repository-backlog__start-work .app-button--primary').trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'review',
      target: 'duplicate',
      workspace: { branchName: 'feature/backlog-workspace', kind: 'worktree' },
    }));
  });

  it('reviews a pull request in the current agent without switching its branch', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({
      branch: 'feature/current-pr',
      items: [workItem({ branchName: 'feature/current-pr', kind: 'pullRequest', number: 22, title: 'Update current workspace' })],
      startWorkAction,
    });

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click');
    await wrapper.get('[aria-label="Work item actions #22"]').trigger('click');
    await wrapper.findAll('.work-item-assignment-picker__target-options > button')[1]!.trigger('click');

    expect(wrapper.find<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('feature/current-pr');
    await wrapper.get('.repository-backlog__start-work .app-button--primary').trigger('click');
    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'review',
      target: 'current',
      workspace: { kind: 'current' },
    }));
  });

  it('allows pull request work to resolve missing branch metadata at dispatch time', async () => {
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = await mountPanel({
      items: [workItem({ kind: 'pullRequest', number: 23, title: 'Resolve remote branch' })],
      startWorkAction,
    });

    await wrapper.get('[role="radio"][aria-checked="false"]').trigger('click');
    await wrapper.get('[aria-label="Work item actions #23"]').trigger('click');
    expect(wrapper.text()).not.toContain('The pull request branch is unavailable');
    expect(wrapper.get('.repository-backlog__start-work .app-button--primary').attributes('disabled')).toBeUndefined();
    await wrapper.get('.repository-backlog__start-work .app-button--primary').trigger('click');

    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'review' }));
  });

  it('keeps start work open on pointer exit and dismisses it on outside close or inactive workspace', async () => {
    const wrapper = await mountPanel();

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    expect(wrapper.text()).toContain('Start work on #12');
    const startWorkPopover = wrapper.findAllComponents({ name: 'ElPopover' }).find(popover => popover.attributes('popper-class')?.includes('repository-backlog__start-popover'));
    expect(startWorkPopover?.props('trigger')).toBe('click');

    await wrapper.get('.repository-backlog__start-work').trigger('mouseleave');
    expect(wrapper.text()).toContain('Start work on #12');

    startWorkPopover?.vm.$emit('update:visible', false);
    await nextTick();
    expect(wrapper.text()).not.toContain('Start work on #12');

    await wrapper.get('[aria-label="Work item actions #12"]').trigger('click');
    await wrapper.setProps({ visible: false });
    expect(wrapper.text()).not.toContain('Start work on #12');
  });
});

async function mountPanel(overrides: Partial<InstanceType<typeof RepositoryBacklogPanel>['$props']> & { items?: WorkItem[] } = {}) {
  const { items = [workItem()], ...componentOverrides } = overrides;
  const props = {
    agent,
    agents: [agent],
    assignments: {},
    branch: 'main',
    repositoryId: 'nbonamy/agent-workspace',
    startWorkAction: vi.fn().mockResolvedValue(undefined),
    visible: true,
    ...componentOverrides,
  } as InstanceType<typeof RepositoryBacklogPanel>['$props'];
  const api = appApi!;
  const load = vi.mocked(api.listWorkItems).getMockImplementation();
  vi.mocked(api.listWorkItems).mockImplementation(async (provider, id, location, query) => provider === 'github' ? [...items] : await load!(provider, id, location, query));
  const sources = vi.mocked(api.listWorkSources).getMockImplementation();
  vi.mocked(api.listWorkSources).mockImplementation(async (provider, location) => provider === 'github' ? [{ provider, id: props.repositoryId, name: props.repositoryId, fullName: props.repositoryId, url: 'https://github.com/' + props.repositoryId }] : await sources!(provider, location));
  const wrapper = mount(RepositoryBacklogPanel, {
    props,
    global: {
      provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }, { provider: 'linear', status: 'connected' }] },
      stubs: {
        ElPopover: {
          name: 'ElPopover',
          props: ['trigger', 'visible'],
          emits: ['update:visible'],
          template: '<div><slot name="reference" /><slot v-if="visible !== false" /></div>',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const agent: Agent = {
  id: 'agent-dina',
  name: 'Dina',
  avatar: 'DI',
  folder: '/Users/nbonamy/src/agent-workspace',
  backend: 'codex',
  backendDefaults: { kind: 'codex' },
  status: { type: 'idle' },
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    provider: 'github',
    id: 'nbonamy/agent-workspace#12',
    kind: 'issue',
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number: 12,
    title: 'Fix backlog assignment',
    url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    state: 'open',
    labels: [{ name: 'bug', color: 'ff0000' }],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}
