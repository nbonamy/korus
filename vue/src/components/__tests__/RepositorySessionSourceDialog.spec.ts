import { backlogConnectionsKey } from '../backlog-providers';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { ElDialog } from 'element-plus';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceBranch, WorkItem } from '@workspace/core/contracts';
import '../../styles/base.css';
import RepositorySessionSourceDialog from '../RepositorySessionSourceDialog.vue';
import { createClientApiMock } from '../../test/client-api-mock';
import { appApi, configureAppClient } from '../../platform-api';

const branches: SourceBranch[] = [
  { name: 'main', isDefault: true, worktreePath: '/repos/project' },
  { name: 'feat/polish-dialog', isDefault: false, worktreePath: '/repos/project-polish' },
  { name: 'fix/menu-dismissal', isDefault: false },
];
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

describe('RepositorySessionSourceDialog', () => {
  beforeEach(() => {
    const { api } = createClientApiMock();
    api.listWorkSources.mockResolvedValue([{ provider: 'github', id: issue.sourceId, name: 'agent-workspace', fullName: issue.sourceName, url: 'https://github.com/nbonamy/agent-workspace' }]);
    api.listWorkItems.mockResolvedValue([issue]);
    configureAppClient({ platform: 'desktop', api });
  });
  it('selects a Linear issue in the Mission picker with its provider and source intact', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    api.listWorkSources.mockResolvedValue([{ provider: 'linear', id: 'linear:team', name: 'Engineering', fullName: 'Engineering', owner: 'ENG', isPrivate: true, url: 'https://linear.app' }]);
    const selected: WorkItem = { ...issue, provider: 'linear', id: 'linear:uuid', identifier: 'ENG-24', sourceId: 'linear:team' };
    api.listWorkItems.mockResolvedValue([selected]);
    const wrapper = mount(RepositorySessionSourceDialog, {
      props: { visible: true, repositoryName: '', purpose: 'missionIssue' },
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'disconnected' }, { provider: 'linear', status: 'connected' }] } },
    });
    await flushPromises();
    expect(wrapper.find('[aria-label="Backlog provider"]').exists()).toBe(false);
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Team / project"] select').element.value).toBe('linear:team');
    await wrapper.get('[aria-label="Search issues"]').setValue('ENG-24');
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    expect(wrapper.emitted('select-work-item')).toEqual([[selected]]);
    expect(wrapper.find('[role="tab"]').exists()).toBe(false);
    configureAppClient();
  });
  it('browses Linear on the selected host, ignores an older source response, and keeps branch navigation on GitHub', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    const source = (id: string) => ({ provider: 'linear' as const, id: `linear:${id}`, owner: id, name: id, fullName: id, url: 'https://linear.app', isPrivate: true });
    api.listWorkSources.mockResolvedValue([source('eng'), source('ops')]);
    let resolveOld!: (items: WorkItem[]) => void;
    const item = { ...issue, provider: 'linear' as const, id: 'linear:uuid', identifier: 'OPS-24', sourceId: 'linear:ops', body: 'Issue details', nativeState: 'In progress' };
    api.listWorkItems.mockImplementation(async (_provider, id) => id === 'linear:eng' ? new Promise(resolve => { resolveOld = resolve; }) : [item]);
    const location = { kind: 'remote' as const, remoteConnectionId: 'remote-one' };
    const remoteSnapshot = createInitialSnapshot();
    remoteSnapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'linear', status: 'connected' }];
    api.getAutomationSnapshot.mockResolvedValue(remoteSnapshot);
    const wrapper = mount(RepositorySessionSourceDialog, { props: { visible: true, repositoryName: 'agent-workspace', branches, workItems: [issue], location } });
    await flushPromises();
    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>('[aria-label="Team / project"] select').element.value).toBe('linear:eng');
    expect(api.listWorkItems).toHaveBeenCalledWith('linear', 'linear:eng', location, { kind: 'issue', state: 'open' });
    await wrapper.get('[aria-label="Team / project"] select').setValue('linear:ops');
    await flushPromises();
    resolveOld([{ ...item, identifier: 'ENG-24', sourceId: 'linear:eng' }]);
    await flushPromises();
    expect(wrapper.text()).toContain('OPS-24');
    expect(wrapper.text()).not.toContain('ENG-24');
    expect(api.listWorkItems).toHaveBeenLastCalledWith('linear', 'linear:ops', location, { kind: 'issue', state: 'open' });
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    expect(wrapper.get('.work-item-detail').text()).toContain('Issue details');
    expect(wrapper.get('input[aria-label="Branch"]').element).toHaveProperty('value', 'fix/ops-24');
    await wrapper.get('.work-item-assignment-picker .app-button--tertiary').trigger('click');
    const selection = wrapper.emitted('custom-work-item')![0]![0] as { item: WorkItem; isCurrent: () => boolean };
    expect(selection.item).toEqual(item);
    expect(selection.isCurrent()).toBe(true);
    await wrapper.get('[aria-label="Back"]').trigger('click');
    expect(selection.isCurrent()).toBe(false);
    await wrapper.findAll('[role="tab"]')[0].trigger('click');
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    expect(wrapper.emitted('select-branch')).toEqual([[branches[0]]]);
    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('github');
    api.listWorkSources.mockRejectedValueOnce(new Error('Linear unavailable'));
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Linear unavailable');
    await wrapper.findAll('[role="tab"]')[0].trigger('click');
    expect(wrapper.findAll('.repository-session-source-dialog__result')).toHaveLength(3);
    configureAppClient();
  });
  it('puts the provider choice beside the tabs on the Issues tab', async () => {
    const { api } = createClientApiMock();
    configureAppClient({ platform: 'desktop', api });
    api.listWorkSources.mockResolvedValue([]);
    api.listWorkItems.mockResolvedValue([]);
    const snapshot = createInitialSnapshot();
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'linear', status: 'connected' }];
    api.getAutomationSnapshot.mockResolvedValue(snapshot);
    const wrapper = mount(RepositorySessionSourceDialog, { props: { visible: true, repositoryName: 'agent-workspace', branches, workItems: [], location: { kind: 'remote' as const, remoteConnectionId: 'remote-one' } } });
    await flushPromises();
    expect(wrapper.find('.repository-session-source-dialog__toolbar [aria-label="Backlog provider"]').exists()).toBe(false);
    await wrapper.findAll('[role="tab"]')[2].trigger('click');
    await flushPromises();
    expect(wrapper.find('.repository-session-source-dialog__toolbar-start [aria-label="Backlog provider"]').exists()).toBe(true);
    expect(wrapper.findAll('[aria-label="Backlog provider"]')).toHaveLength(1);
    expect(wrapper.get('.repository-session-source-dialog__toolbar > .repository-session-source-dialog__repository').text()).toContain('agent-workspace');
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    expect(wrapper.find('.repository-session-source-dialog__toolbar-start [aria-label="Team / project"]').exists()).toBe(true);
    configureAppClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps branch metadata compact and gives branch states distinct semantics', async () => {
    const wrapper = mount(RepositorySessionSourceDialog, {
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }] } },
      props: {
        visible: true,
        repositoryName: 'agent-workspace',
        branches,
      },
    });
    await flushPromises();

    expect(wrapper.get('.repository-session-source-dialog').classes()).toContain('app-dialog--compact');

    const rows = wrapper.findAll('.repository-session-source-dialog__result');
    expect(rows).toHaveLength(3);
    expect(rows[0].find('.repository-session-source-dialog__result-icon--default').exists()).toBe(true);
    expect(rows[0].get('.repository-session-source-dialog__result-copy').text()).toBe('mainDefault');
    expect(rows[0].get('.repository-session-source-dialog__badge').text()).toBe('Checked out');
    expect(rows[1].find('.repository-session-source-dialog__result-icon--worktree').exists()).toBe(true);
    expect(rows[2].find('.repository-session-source-dialog__badge').exists()).toBe(false);

    await rows[1].trigger('click');
    expect(wrapper.emitted('select-branch')).toStrictEqual([[branches[1]]]);
  });

  it('uses Element Plus tabs to switch the searchable source type', async () => {
    const wrapper = mount(RepositorySessionSourceDialog, {
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }] } },
      props: {
        visible: true,
        repositoryName: 'agent-workspace',
        branches,
      },
    });
    await flushPromises();

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs.map((candidate) => candidate.text())).toStrictEqual(['Branches', 'Pull requests', 'Issues']);
    await tabs[1]!.trigger('click');
    await flushPromises();

    expect(wrapper.get('[aria-label="Search session sources"]').attributes('placeholder'))
      .toBe('Search by title, number, author, or URL');
    expect(wrapper.text()).toContain('Recent pull requests');
  });

  it('reuses the source dialog as a cross-repository issue picker without branch or PR actions', async () => {
    vi.mocked(appApi!.listWorkSources).mockResolvedValue(['first', 'second'].map(id => ({ provider: 'github', id, name: id, fullName: id, url: 'https://github.com/' + id })));
    const pullRequest: WorkItem = { ...issue, id: 'github:nbonamy/agent-workspace#25', number: 25, kind: 'pullRequest', title: 'Update UI' };
    const wrapper = mount(RepositorySessionSourceDialog, {
      props: {
        visible: true,
        purpose: 'missionIssue',
        repositoryName: '',
        repositories: [
          { provider: 'github', id: 'first', owner: 'nbonamy', name: 'agent-workspace', fullName: 'nbonamy/agent-workspace', url: 'https://github.com/nbonamy/agent-workspace', isPrivate: false },
          { provider: 'github', id: 'second', owner: 'nbonamy', name: 'other', fullName: 'nbonamy/other', url: 'https://github.com/nbonamy/other', isPrivate: false },
        ],
        selectedRepositoryId: 'first',
        branches,
        workItems: [issue, pullRequest],
      },
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }] } },
    });
    await flushPromises();

    // The search header reserves the close-button hit target in compact mode.
    expect(getComputedStyle(wrapper.get('.el-dialog__header').element).paddingRight).toBe('48px');

    expect(wrapper.find('[role="tab"]').exists()).toBe(false);
    expect(wrapper.findAll('.repository-session-source-dialog__result')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Update UI');
    await wrapper.get('[aria-label="Repository"] select').setValue('second');
    await flushPromises();
    expect(wrapper.emitted('select-repository')).toBeUndefined();
    await wrapper.get('[aria-label="Search issues"]').setValue('not found');
    expect(wrapper.find('.repository-session-source-dialog__result').exists()).toBe(false);
    await wrapper.get('[aria-label="Search issues"]').setValue('Repository-first');
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    expect(wrapper.emitted('select-work-item')).toStrictEqual([[issue]]);
    expect(wrapper.findComponent({ name: 'WorkItemAssignmentPicker' }).exists()).toBe(false);
  });

  it('opens the shared assignment picker for repository work items', async () => {
    const wrapper = mount(RepositorySessionSourceDialog, {
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }] } },
      props: {
        visible: true,
        repositoryName: 'agent-workspace',
        branches,
        workItems: [issue],
        selectedRepositoryId: issue.sourceId,
        sessions: [{ agentId: 'agent-main', label: 'main · main' }],
      },
    });
    await flushPromises();

    expect(wrapper.get('.repository-session-source-dialog').attributes('style')).toContain('width: 720px');
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    await flushPromises();
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');

    expect(wrapper.getComponent({ name: 'WorkItemAssignmentPicker' }).props('item')).toStrictEqual(issue);
    expect(wrapper.text()).toContain('Start work on #24');
    expect(wrapper.find('.repository-session-source-dialog__toolbar').exists()).toBe(false);
    expect(wrapper.get('.repository-session-source-dialog').classes()).toContain('repository-session-source-dialog--assignment');
    expect(wrapper.get('.repository-session-source-dialog').attributes('style')).toContain('width: 720px');

    await wrapper.get('.app-button--primary').trigger('click');
    expect(wrapper.emitted('start-work-item')).toStrictEqual([[
      { action: 'fix', destination: 'new', item: issue, backend: 'codex', isCurrent: expect.any(Function) },
    ]]);
  });

  it('leaves progress to the standard provisioning dialog once work is confirmed', async () => {
    const wrapper = mount(RepositorySessionSourceDialog, {
      global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }] } },
      props: {
        visible: true,
        repositoryName: 'agent-workspace',
        branches,
        workItems: [issue],
        selectedRepositoryId: issue.sourceId,
      },
    });
    await flushPromises();
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click');
    await flushPromises();
    await wrapper.get('.repository-session-source-dialog__result').trigger('click');
    await wrapper.get('.app-button--primary').trigger('click');

    expect(wrapper.emitted('start-work-item')).toHaveLength(1);
    expect(wrapper.find('.staged-operation-progress').exists()).toBe(false);
  });
});
