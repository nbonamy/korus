import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { WorkItem, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import { mockWorkProvider as provider, mockWorkSource, mockWorkItem, registerMockWorkProvider } from '@workspace/core/__tests__/fixtures/mock-work-provider';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import { backlogConnectionsKey } from '../backlog-providers';
import RepositorySessionSourceDialog from '../RepositorySessionSourceDialog.vue';
import SettingsIntegrationsPanel from '../SettingsIntegrationsPanel.vue';
import BacklogView from '../BacklogView.vue';
import { useCockpitBacklog } from '../use-cockpit-backlog';
import { workProviderDefinition } from '@workspace/core/work-providers';

let unregister: (() => void) | undefined;
afterEach(() => { unregister?.(); configureAppClient(); });

it('shows only the selected provider catalog error and keeps a healthy global feed free of catalog errors', async () => {
  window.localStorage.clear();
  const snapshot = reactive(createInitialSnapshot());
  snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }];
  const Host = defineComponent({ setup() {
    const state = useCockpitBacklog({ getSnapshot: () => snapshot, configure: async () => {}, confirmLoadAll: async () => true,
      getWorkBacklogError: provider => provider === 'gitlab' ? 'GitLab rate limit reached' : provider === 'github' ? null : 'Unscoped catalog failure',
      getWorkBacklogStatus: () => 'error', getWorkItemsByRepository: () => ({}),
      getWorkRepositories: provider => [{ provider, id: provider, name: provider, fullName: provider, url: 'https://example.test' }],
      loadWorkRepositories: async () => {}, loadWorkItems: async () => {}, loadGlobalWorkItems: async () => ({ items: [] }),
    });
    void state.initialize();
    return () => h(BacklogView, { agents: [], teams: [], workProvider: state.provider.value, workProviders: state.providers.value, workBacklog: state.workBacklog.value,
      startWorkItemsAction: async () => {}, saveRepositoryFavorites: async () => {}, onSelectWorkProvider: state.selectProvider, onSelectWorkRepository: state.selectRepository });
  } });
  const wrapper = mount(Host); await flushPromises();
  expect(wrapper.text()).not.toContain('Unscoped catalog failure');
  await wrapper.get('[aria-label="Backlog provider"] select').setValue('gitlab'); await flushPromises();
  await wrapper.get('[data-repository-id="gitlab"] button[aria-pressed]').trigger('click'); await flushPromises();
  expect(wrapper.text()).toContain('GitLab rate limit reached');
  await wrapper.get('[aria-label="Backlog provider"] select').setValue('github'); await flushPromises();
  expect(wrapper.text()).not.toContain('GitLab rate limit reached');
  wrapper.unmount(); window.localStorage.clear();
});

it('restores independently selected sources and filters after switching GitHub, GitLab and Linear or reopening', async () => {
  window.localStorage.clear();
  const snapshot = reactive(createInitialSnapshot());
  const providers: WorkProviderKind[] = ['github', 'gitlab', 'linear'];
  snapshot.workBacklog.connections = providers.map(provider => ({ provider, status: 'connected' }));
  const sources: WorkSource[] = providers.map(provider => ({ provider, id: `${provider}:scope`, name: provider, fullName: `${provider}/scope`, url: `https://${provider}.com/scope` }));
  const items = Object.fromEntries(sources.map(source => [`${source.provider}:${source.id}`, [{ ...mockWorkItem, provider: source.provider, sourceId: source.id, assignees: ['alice'], labels: [{ name: 'bug' }] }]]));
  const Host = defineComponent({ setup() {
    const state = useCockpitBacklog({ getSnapshot: () => snapshot,
      configure: async ({ provider, configuration }) => { snapshot.workBacklog.providerConfigurations[provider] = Object.fromEntries(Object.entries(configuration).filter(([, value]) => value !== null)); },
      confirmLoadAll: async () => true, getWorkBacklogError: () => null, getWorkBacklogStatus: () => 'loaded',
      getWorkItemsByRepository: () => items, getWorkRepositories: provider => sources.filter(source => source.provider === provider),
      loadWorkRepositories: async () => {}, loadWorkItems: async () => {}, loadGlobalWorkItems: async () => ({ items: [] }),
    });
    void state.initialize();
    return () => h(BacklogView, { agents: [], teams: [], workProvider: state.provider.value, workProviders: state.providers.value, workBacklog: state.workBacklog.value,
      startWorkItemsAction: async () => {}, saveRepositoryFavorites: async () => {}, onSelectWorkProvider: state.selectProvider,
      onSelectWorkRepository: state.selectRepository, onSelectWorkAssignee: state.selectAssignee, onSelectWorkTag: state.selectTag });
  } });
  let wrapper = mount(Host);
  for (const provider of providers) {
    await wrapper.get('[aria-label="Backlog provider"] select').setValue(provider);
    await flushPromises();
    await wrapper.get(`[data-repository-id="${provider}:scope"] button[aria-pressed]`).trigger('click');
    await flushPromises();
    await wrapper.get('.cockpit-inbox__filter-button').trigger('click');
    await wrapper.get('[aria-label="Label filter"] select').setValue('bug');
    await flushPromises();
    await wrapper.get('[aria-label="Assignee filter"] select').setValue('alice');
    await flushPromises();
  }
  for (const provider of providers) {
    await wrapper.get('[aria-label="Backlog provider"] select').setValue(provider);
    await flushPromises();
    expect(wrapper.get(`[data-repository-id="${provider}:scope"] button[aria-pressed]`).attributes('aria-pressed')).toBe('true');
    expect(snapshot.workBacklog.providerConfigurations[provider]).toStrictEqual({ sourceId: `${provider}:scope`, assigneeLogin: 'alice', tagName: 'bug' });
  }
  wrapper.unmount();
  wrapper = mount(Host); await flushPromises();
  expect(wrapper.get('[data-repository-id="linear:scope"] button[title="linear"]').attributes('aria-pressed')).toBe('true');
  wrapper.unmount(); window.localStorage.clear();
});

it('selects GitLab issues for a Mission while keeping a matching MR separate in repository work', async () => {
  const { api } = createClientApiMock();
  configureAppClient({ platform: 'desktop', api });
  const source = { provider: 'gitlab' as const, id: 'gitlab.com/group/sub/repo', name: 'repo', fullName: 'group/sub/repo', url: 'https://gitlab.com/group/sub/repo' };
  const issue: WorkItem = { provider: 'gitlab', id: `${source.id}#7`, identifier: '#7', number: 7, kind: 'issue', sourceId: source.id, sourceName: source.fullName, title: 'Repair login', body: 'Private details', state: 'open', url: `${source.url}/-/issues/7`, labels: [], createdAt: '', updatedAt: '' };
  api.listWorkSources.mockImplementation(async provider => provider === 'gitlab' ? [source] : []);
  api.listWorkItems.mockResolvedValue([issue]);
  const picker = mount(RepositorySessionSourceDialog, {
    props: { visible: true, repositoryName: 'Execution code', purpose: 'missionIssue' },
    global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider: 'github', status: 'connected' }, { provider: 'gitlab', status: 'connected' }] } },
  });
  await picker.get('[aria-label="Backlog provider"] select').setValue('gitlab');
  await flushPromises();
  expect(api.listWorkItems).toHaveBeenLastCalledWith('gitlab', source.id, undefined, { kind: 'issue', state: 'open' });
  await picker.get('.repository-session-source-dialog__result').trigger('click');
  expect(picker.emitted('select-work-item')).toStrictEqual([[issue]]);
  picker.unmount();
});

it('keeps a repository-bound picker empty until its explicit source is available', async () => {
  unregister = registerMockWorkProvider();
  workProviderDefinition(provider).repositoryBacked = true;
  const { api } = createClientApiMock();
  configureAppClient({ platform: 'desktop', api });
  const wanted = { ...mockWorkSource, id: 'wanted' };
  const other = { ...mockWorkSource, id: 'other' };
  api.listWorkSources.mockResolvedValue([other, wanted]);
  api.listWorkItems.mockResolvedValue([]);
  const picker = mount(RepositorySessionSourceDialog, {
    props: { visible: true, repositoryName: 'Current checkout' },
    global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider, status: 'connected' }] } },
  });
  await flushPromises();
  expect(api.listWorkItems).not.toHaveBeenCalled();
  await picker.setProps({ selectedRepositoryId: 'wanted' });
  await flushPromises();
  expect(api.listWorkItems).toHaveBeenCalledWith(provider, 'wanted', undefined, expect.any(Object));
  api.listWorkItems.mockClear();
  await picker.setProps({ selectedRepositoryId: 'unavailable' });
  await flushPromises();
  expect(api.listWorkItems).not.toHaveBeenCalled();
  expect(picker.find('.repository-session-source-dialog__result').exists()).toBe(false);
  picker.unmount();
});

it('connects, browses and selects a third provider without numeric issues or code repositories in its source model', async () => {
  unregister = registerMockWorkProvider();
  const settings = mount(SettingsIntegrationsPanel, { props: { connections: [] } });
  await settings.get('[aria-label="Connect Mock work source"]').trigger('click');
  expect(settings.emitted('connect')).toEqual([[provider]]);
  settings.unmount();

  const { api } = createClientApiMock();
  configureAppClient({ platform: 'desktop', api });
  api.listWorkSources.mockResolvedValue([mockWorkSource]);
  const item = mockWorkItem;
  const closed = { ...item, id: 'task:closed', title: 'Already resolved', state: 'closed' as const };
  api.listWorkItems.mockImplementation(async (_provider, _source, _location, query) => query?.state === 'open' ? [item] : [item, closed]);
  const picker = mount(RepositorySessionSourceDialog, {
    props: { visible: true, repositoryName: 'Current code repository' },
    global: { provide: { [backlogConnectionsKey as symbol]: () => [{ provider, status: 'connected' }] } },
  });
  await flushPromises();
  await picker.findAll('[role="tab"]')[2]!.trigger('click');
  await flushPromises();
  expect(api.listWorkItems).toHaveBeenCalledWith(provider, 'board:opaque', undefined, { kind: 'issue', state: 'open' });
  expect(picker.text()).not.toContain('Already resolved');
  expect(picker.text()).toContain('TASK-blue');
  expect(picker.text()).not.toContain('#undefined');
  await picker.get('.repository-session-source-dialog__result').trigger('click');
  expect(picker.get('.work-item-detail').text()).toContain(item.body!);
  expect(picker.get<HTMLInputElement>('input[aria-label="Branch"]').element.value).toBe('fix/task-blue');
  await picker.get('.work-item-assignment-picker .app-button--primary').trigger('click');
  const selection = picker.emitted('start-work-item')![0]![0] as { item: WorkItem; isCurrent: () => boolean };
  expect(selection.item).toEqual(item);
  expect(selection.isCurrent()).toBe(true);
  await picker.setProps({ visible: false });
  expect(selection.isCurrent()).toBe(false);
  picker.unmount();
});

it('uses opaque continuations without totals, including an empty filtered page and cached back navigation', async () => {
  unregister = registerMockWorkProvider();
  const snapshot = reactive(createInitialSnapshot());
  snapshot.workBacklog.connections = [{ provider, status: 'connected' }];
  snapshot.workBacklog.assignments[`${provider}:task:elsewhere`] = {
    provider, itemId: 'task:elsewhere', agentId: snapshot.agents[0]!.id,
    assignedAt: 'now', policy: 'review', status: 'inProgress',
  };
  const loadGlobalWorkItems = vi.fn()
    .mockResolvedValueOnce({ items: [], nextCursor: 'native:after-blue' })
    .mockResolvedValueOnce({ items: [mockWorkItem] });
  const Harness = defineComponent({
    setup() {
      const state = useCockpitBacklog({
        getSnapshot: () => snapshot, configure: async () => {}, confirmLoadAll: async () => true,
        getWorkBacklogError: () => null, getWorkBacklogStatus: () => 'loaded',
        getWorkItemsByRepository: () => ({}), getWorkRepositories: () => [mockWorkSource],
        loadWorkRepositories: async () => {}, loadWorkItems: async () => {}, loadGlobalWorkItems,
      });
      void state.initialize();
      return () => h(BacklogView, {
        agents: [], teams: [], workProvider: state.provider.value, workProviders: state.providers.value,
        workBacklog: state.workBacklog.value, startWorkItemsAction: async () => {}, saveRepositoryFavorites: async () => {},
        onChangeWorkItemsPage: state.changePage,
      });
    },
  });
  const wrapper = mount(Harness);
  await flushPromises();
  expect(loadGlobalWorkItems).toHaveBeenCalledWith({ assignment: 'viewer', state: 'open', pageSize: 25 }, provider);
  expect(wrapper.get<HTMLButtonElement>('[aria-label="Next page"]').element.disabled).toBe(false);
  expect(wrapper.get('.cockpit-inbox__pagination').text()).not.toContain('total');
  await wrapper.get('[aria-label="Next page"]').trigger('click');
  await flushPromises();
  expect(loadGlobalWorkItems).toHaveBeenLastCalledWith({ assignment: 'viewer', state: 'open', pageSize: 25, cursor: 'native:after-blue' }, provider);
  expect(wrapper.findAll('.cockpit-inbox__view-count').map(count => count.text())).toEqual(['1', '1', '0', '0']);
  expect(wrapper.text()).toContain('TASK-blue');
  expect(wrapper.get<HTMLButtonElement>('[aria-label="Next page"]').element.disabled).toBe(true);
  await wrapper.get('[aria-label="Previous page"]').trigger('click');
  await flushPromises();
  expect(loadGlobalWorkItems).toHaveBeenCalledTimes(2);
  expect(wrapper.get('.cockpit-inbox__pagination').text()).toContain('Page 1');
  wrapper.unmount();
});
