import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { WorkItem, WorkSource } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import BacklogView from '../BacklogView.vue';
import CockpitWorkInbox from '../CockpitWorkInbox.vue';
import { useCockpitBacklog } from '../use-cockpit-backlog';
import '../../styles/base.css';

describe('BacklogView', () => {
  it('reveals keyboard-focused favorite controls without a button outline', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', '')], undefined, 'nbonamy/a', document.body);
    try {
      await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'] });
      const star = wrapper.get<HTMLButtonElement>('[aria-label="Remove a from favorites"]');
      star.element.focus();
      expect(document.activeElement).toBe(star.element);
      expect(getComputedStyle(star.element).opacity).toBe('1');
      expect(getComputedStyle(star.element).outline).toBe('none');
    } finally {
      wrapper.unmount();
    }
  });

  it('favorites and reorders Linear sources without changing selection, and filters both sections', async () => {
    const sources: WorkSource[] = ['Engineering', 'Research', 'Support'].map(name => ({ ...repository(name, ''), provider: 'linear', id: `${name.toLowerCase()}-uuid`, fullName: name }));
    const wrapper = mountView(createInitialSnapshot(), [], sources, undefined, 'research-uuid');
    await wrapper.setProps({ workProvider: 'linear', repositoryFavorites: ['research-uuid', 'engineering-uuid'] });
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['Research', 'Engineering', 'Support']);
    expect(wrapper.findAll('.cockpit-view__favorites-heading').map(heading => heading.text())).toStrictEqual(['Favorites', 'Sources']);
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    await wrapper.get('[aria-label="Reorder Engineering"]').trigger('dragstart', { dataTransfer: transfer });
    const target = wrapper.get('[data-repository-id="research-uuid"]');
    vi.spyOn(target.element, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 40 } as DOMRect);
    await target.trigger('dragover', { clientY: 11, dataTransfer: transfer });
    await target.trigger('drop', { clientY: 11, dataTransfer: transfer });
    await flushPromises();
    expect(wrapper.props('repositoryFavorites')).toStrictEqual(['engineering-uuid', 'research-uuid']);
    await wrapper.get('input[aria-label="Filter sources"]').setValue('Research');
    expect(wrapper.findAll('.cockpit-view__repositories > div')).toHaveLength(1);
    await wrapper.get('input[aria-label="Filter sources"]').setValue('');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['Engineering', 'Research', 'Support']);
    await wrapper.get('[aria-label="Remove Engineering from favorites"]').trigger('click');
    await wrapper.get('[aria-label="Add Support to favorites"]').trigger('click');
    await flushPromises();
    expect(wrapper.props('repositoryFavorites')).toStrictEqual(['research-uuid', 'support-uuid']);
    expect(wrapper.get('[title="Research"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    await wrapper.get('[title="Support"]').trigger('click');
    expect(wrapper.emitted('select-work-repository')).toStrictEqual([['support-uuid']]);
  });

  it('rolls back a failed favorite save and accepts later saved preferences', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', '')]);
    let rejectSave!: (error: Error) => void;
    const saveRepositoryFavorites = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'], saveRepositoryFavorites });
    await wrapper.get('[aria-label="Add b to favorites"]').trigger('click');
    expect(wrapper.find('[aria-label="Remove b from favorites"]').exists()).toBe(true);
    rejectSave(new Error('Disconnected'));
    await flushPromises();
    expect(wrapper.find('[aria-label="Add b to favorites"]').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save favorites');
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/b'] });
    expect(wrapper.find('[aria-label="Remove b from favorites"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Add a to favorites"]').exists()).toBe(true);
  });

  it('keeps the latest optimistic change until its save settles and adopts the saved result', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', '')]);
    const saves: Array<(value?: void) => void> = [];
    const saveRepositoryFavorites = vi.fn(() => new Promise<void>(resolve => { saves.push(resolve); }));
    await wrapper.setProps({ saveRepositoryFavorites });
    await wrapper.get('[aria-label="Add a to favorites"]').trigger('click');
    await wrapper.get('[aria-label="Add b to favorites"]').trigger('click');
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'] });
    saves[0]!();
    await flushPromises();
    expect(wrapper.find('[aria-label="Remove b from favorites"]').exists()).toBe(true);
    // A completed save can return a normalized result rather than the requested array.
    saves[1]!();
    await flushPromises();
    expect(wrapper.find('[aria-label="Add b to favorites"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Remove a from favorites"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('switches provider before source and rejects a late global feed from the previous provider', async () => {
    window.localStorage.clear();
    const snapshot = reactive(createInitialSnapshot());
    snapshot.workBacklog.connections = [{ provider: 'github', status: 'connected' }, { provider: 'linear', status: 'connected', accountLabel: 'Alex · Acme' }];
    const linearItem: WorkItem = { ...item(24), provider: 'linear', id: 'linear:uuid', identifier: 'ENG-24', sourceId: 'linear:team', title: 'Linear issue', body: 'Linear details', nativeState: 'Started' };
    let resolveOld!: (page: import('@workspace/core/contracts').WorkItemPage) => void;
    const load = vi.fn(async (_query, provider) => provider === 'linear'
      ? { items: [linearItem], totalItems: 1 }
      : new Promise<import('@workspace/core/contracts').WorkItemPage>(resolve => { resolveOld = resolve; }));
    const source = { ...repository('team', '2026-01-01'), provider: 'linear' as const, id: 'linear:team', name: 'Engineering', fullName: 'Engineering' };
    const Harness = defineComponent({ setup() {
      const state = useCockpitBacklog({ getSnapshot: () => snapshot, configure: async input => { snapshot.workBacklog.providerConfigurations[input.provider] = { sourceId: input.configuration.sourceId ?? undefined }; }, confirmLoadAll: async () => true, getWorkBacklogError: () => null, getWorkBacklogStatus: () => 'loaded', getWorkItemsByRepository: () => ({ 'linear:linear:team': [linearItem] }), getWorkRepositories: provider => provider === 'linear' ? [source] : [repository('repo', '2026-01-01')], loadGlobalWorkItems: load, loadWorkItems: async () => {}, loadWorkRepositories: async () => {} });
      void state.initialize();
      return () => h(BacklogView, { agents: [], teams: [], workProviders: state.providers.value, workProvider: state.provider.value, workBacklog: state.workBacklog.value, startWorkItemsAction: async () => {}, saveRepositoryFavorites: async () => {}, onSelectWorkProvider: state.selectProvider, onSelectWorkRepository: state.selectRepository });
    } });
    const wrapper = mount(Harness);
    await flushPromises();
    await wrapper.get('[aria-label="Backlog provider"] select').setValue('linear');
    await flushPromises();
    resolveOld({ items: [item(99)], totalItems: 1 });
    await flushPromises();
    expect(wrapper.text()).toContain('ENG-24');
    expect(wrapper.text()).not.toContain('#99');
    expect(wrapper.get('.cockpit-view__repositories button[aria-pressed]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('.cockpit-inbox__row-action').trigger('click');
    expect(wrapper.get('.work-item-detail').text()).toContain('Linear details');
    expect(snapshot.workBacklog.providerConfigurations.linear?.sourceId).toBe('linear:team');
    expect(load).toHaveBeenCalledTimes(1);
    snapshot.workBacklog.connections[0]!.status = 'disconnected';
    await flushPromises();
    expect(wrapper.find('[aria-label="Backlog provider"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('ENG-24');
    window.localStorage.clear();
  });
  it('moves favorites between sections without selecting them, and selects a favorite through the existing event', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', '')], undefined, 'nbonamy/a');
    expect(wrapper.find('.cockpit-view__favorites-heading').exists()).toBe(false);
    await wrapper.get('[aria-label="Add b to favorites"]').trigger('click');
    expect(wrapper.get('.cockpit-view__favorites-heading').text()).toBe('Favorites');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['b', 'a']);
    expect(vi.mocked(wrapper.props('saveRepositoryFavorites')).mock.calls).toStrictEqual([[['nbonamy/b']]]);
    expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    expect(wrapper.get('[title="a"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('[title="b"]').trigger('click');
    expect(wrapper.emitted('select-work-repository')).toStrictEqual([['nbonamy/b']]);
    await wrapper.get('[aria-label="Remove b from favorites"]').trigger('click');
    expect(wrapper.find('.cockpit-view__favorites-heading').exists()).toBe(false);
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['a', 'b']);
    expect(wrapper.emitted('select-work-repository')).toHaveLength(1);
  });

  it('filters both sections without saving or losing favorite order and adopts persisted preferences on remount', async () => {
    const repositories = [repository('a', ''), repository('b', ''), repository('c', '')];
    const wrapper = mountView(createInitialSnapshot(), [], repositories);
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/b', 'nbonamy/a', 'unavailable'] });
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('/a');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['a']);
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('/c');
    expect(wrapper.find('.cockpit-view__favorites-heading').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Add c to favorites"]').exists()).toBe(true);
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['b', 'a', 'c']);
    expect(wrapper.props('saveRepositoryFavorites')).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Add c to favorites"]').trigger('click');
    expect(vi.mocked(wrapper.props('saveRepositoryFavorites')).mock.calls).toStrictEqual([[['nbonamy/b', 'nbonamy/a', 'unavailable', 'nbonamy/c']]]);
    wrapper.unmount();
    const restored = mountView(createInitialSnapshot(), [], repositories);
    await restored.setProps({ repositoryFavorites: ['nbonamy/b', 'nbonamy/a', 'unavailable', 'nbonamy/c'] });
    expect(restored.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['b', 'a', 'c']);
  });

  it('reorders favorites by drag and keyboard without selecting a repository or losing hidden favorites', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')], undefined, 'nbonamy/c');
    const saves: Array<(value?: void) => void> = [];
    const saveRepositoryFavorites = vi.fn(() => new Promise<void>(resolve => { saves.push(resolve); }));
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a', 'unavailable', 'nbonamy/b', 'nbonamy/c'], saveRepositoryFavorites });
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    await wrapper.get('[aria-label="Reorder b"]').trigger('dragstart', { dataTransfer: transfer });
    const first = wrapper.get('[data-repository-id="nbonamy/a"]');
    vi.spyOn(first.element, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 36 } as DOMRect);
    await first.trigger('dragover', { clientY: 11, dataTransfer: transfer });
    expect(first.classes()).toContain('list-reorder-drag--drop-before');
    await first.trigger('drop', { clientY: 11, dataTransfer: transfer });
    expect(saveRepositoryFavorites.mock.calls[0]).toStrictEqual([['nbonamy/b', 'nbonamy/a', 'unavailable', 'nbonamy/c']]);
    expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    expect(wrapper.get('[title="c"]').attributes('aria-pressed')).toBe('true');
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('/a');
    await wrapper.get('[aria-label="Reorder a"]').trigger('keydown', { key: 'ArrowUp' });
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('');
    expect(saveRepositoryFavorites.mock.calls[1]).toStrictEqual([['nbonamy/a', 'nbonamy/b', 'unavailable', 'nbonamy/c']]);
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['a', 'b', 'c']);
    // A delayed snapshot from the earlier drag must not undo the more recent keyboard move.
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/b', 'nbonamy/a', 'unavailable', 'nbonamy/c'] });
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['a', 'b', 'c']);
    expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    saves[0]!();
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a', 'nbonamy/b', 'unavailable', 'nbonamy/c'] });
    saves[1]!();
    await flushPromises();
  });

  it('cancels a drag without saving and keeps regular repositories out of the reorder targets', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')]);
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a', 'nbonamy/b'] });
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    await wrapper.get('[aria-label="Reorder a"]').trigger('dragstart', { dataTransfer: transfer });
    await wrapper.get('[data-repository-id="nbonamy/c"]').trigger('drop', { dataTransfer: transfer });
    await wrapper.get('[aria-label="Reorder a"]').trigger('dragend');
    expect(wrapper.props('saveRepositoryFavorites')).not.toHaveBeenCalled();
    expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    await wrapper.get('[aria-label="Remove b from favorites"]').trigger('click');
    expect(wrapper.get('[aria-label="Reorder a"]').attributes('draggable')).toBe('false');
    expect(wrapper.find('[aria-label="Reorder b"]').exists()).toBe(false);
  });

  it('retains star focus while adding and removing a favorite without selecting it', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')], undefined, 'nbonamy/a', document.body);
    try {
      await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'] });
      const star = wrapper.get<HTMLButtonElement>('[aria-label="Add c to favorites"]');
      star.element.focus();
      await star.trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[aria-label="Remove c from favorites"]').element);
      await star.trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[aria-label="Add c to favorites"]').element);
      expect(wrapper.emitted('select-work-repository')).toBeUndefined();
      expect(wrapper.get('[title="a"]').attributes('aria-pressed')).toBe('true');
    } finally {
      wrapper.unmount();
    }
  });

  it('leaves pointer activation out of keyboard focus restoration when a row moves', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')], undefined, 'nbonamy/a', document.body);
    try {
      await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'] });
      const star = wrapper.get<HTMLButtonElement>('[aria-label="Add c to favorites"]');
      star.element.focus();
      star.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      await flushPromises();
      expect(wrapper.find('[aria-label="Remove c from favorites"]').exists()).toBe(true);
      expect(document.activeElement).not.toBe(star.element);
      expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('places the keyboard reorder handle before repository selection in tab order', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', '')]);
    await wrapper.setProps({ repositoryFavorites: ['nbonamy/a'] });
    const row = wrapper.get('[data-repository-id="nbonamy/a"]');
    expect(row.findAll('button').map(button => button.attributes('aria-label') ?? button.attributes('title'))).toStrictEqual(['Reorder a', 'a', 'Remove a from favorites']);
  });

  it('retains handle focus when a failed keyboard reorder restores the saved order', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')], undefined, 'nbonamy/a', document.body);
    try {
      let rejectSave!: (error: Error) => void;
      await wrapper.setProps({ repositoryFavorites: ['nbonamy/a', 'nbonamy/b', 'nbonamy/c'], saveRepositoryFavorites: () => new Promise<void>((_resolve, reject) => { rejectSave = reject; }) });
      const handle = wrapper.get<HTMLButtonElement>('[aria-label="Reorder a"]');
      handle.element.focus();
      await handle.trigger('keydown', { key: 'ArrowDown' });
      rejectSave(new Error('Disconnected'));
      await flushPromises();
      expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(['a', 'b', 'c']);
      expect(document.activeElement).toBe(handle.element);
      expect(wrapper.emitted('select-work-repository')).toBeUndefined();
      await handle.trigger('keydown', { key: 'ArrowDown' });
      const filter = wrapper.get<HTMLInputElement>('input[aria-label="Filter repositories"]');
      filter.element.focus();
      rejectSave(new Error('Disconnected'));
      await flushPromises();
      expect(document.activeElement).toBe(filter.element);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps focus on the favorite handle through repeated keyboard moves', async () => {
    const wrapper = mountView(createInitialSnapshot(), [], [repository('a', ''), repository('b', ''), repository('c', '')], undefined, null, document.body);
    try {
      await wrapper.setProps({ repositoryFavorites: ['nbonamy/a', 'nbonamy/b', 'nbonamy/c'] });
      const handle = wrapper.get<HTMLButtonElement>('[aria-label="Reorder c"]');
      handle.element.focus();
      for (const [key, order] of [
        ['ArrowUp', ['a', 'c', 'b']],
        ['ArrowUp', ['c', 'a', 'b']],
        ['ArrowDown', ['a', 'c', 'b']],
      ] as const) {
        await handle.trigger('keydown', { key });
        await flushPromises();
        expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.get('button[aria-pressed]').text())).toStrictEqual(order);
        expect(document.activeElement).toBe(handle.element);
      }
      expect(wrapper.emitted('select-work-repository')).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('presents Backlog as an operator inbox and keeps search inside it', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mountView(snapshot, []);

    expect(wrapper.findAll('h1')).toHaveLength(1);
    expect(wrapper.get('.workspace-header h1').text()).toBe('Backlog');
    expect(wrapper.get('[data-tone="working"] span').text()).toBe('working');
    expect(wrapper.get('[data-tone="working"] strong').text()).toBe('0');
    expect(wrapper.get('[data-tone="review"] span').text()).toBe('ready for review');
    expect(wrapper.get('[data-tone="review"] strong').text()).toBe('0');
    expect(wrapper.find('.cockpit-view__activity').exists()).toBe(false);
    expect(wrapper.findAll('.cockpit-view__summary button i')).toHaveLength(0);
    expect(wrapper.find('.cockpit-view__agent-card').exists()).toBe(false);
    expect(wrapper.findComponent(CockpitWorkInbox).exists()).toBe(true);

    const navigation = wrapper.get('[aria-label="Backlog navigation"]');
    expect(navigation.text()).not.toContain('Settings');
    expect(navigation.find('input[aria-label="Search Cockpit work"]').exists()).toBe(false);

    wrapper.findComponent(CockpitWorkInbox).vm.$emit('update-search-query', 'operator');
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(CockpitWorkInbox).props('searchQuery')).toBe('operator');
  });

  it('supports repository navigation, sorting, filtering, and stable activity order', async () => {
    const snapshot = createInitialSnapshot();
    const initialRepositories = [
      repository('older', '2026-08-14T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
      repository('recent', '2026-08-01T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
    ];
    const wrapper = mountView(snapshot, [item(24)], initialRepositories, vi.fn().mockResolvedValue(undefined), 'nbonamy/recent');
    const rows = wrapper.findAll('.cockpit-view__repositories > div');

    expect(wrapper.get('.cockpit-view__navigation-section').text()).toContain('Repositories');
    expect(wrapper.get('[aria-label="Sort repositories by recent activity"]').text()).toContain('Recent');
    expect(rows.map((row) => row.text())).toStrictEqual(['recent', 'older']);
    expect(rows[0]!.findAll('button')[0]!.attributes('aria-pressed')).toBe('true');
    expect(rows[0]!.findAll('button')[0]!.attributes('title')).toBe('recent');

    await wrapper.get('input[aria-label="Filter repositories"]').setValue('old');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map((row) => row.text())).toStrictEqual(['older']);
    await wrapper.get('input[aria-label="Filter repositories"]').setValue('');

    await wrapper.getComponent({ name: 'ElDropdown' }).vm.$emit('command', 'alphabetical');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[aria-label="Sort repositories by name"]').text()).toContain('A–Z');
    expect(wrapper.findAll('.cockpit-view__repositories > div').map((row) => row.text())).toStrictEqual(['older', 'recent']);

    await wrapper.findAll('.cockpit-view__repositories > div')[1]!.findAll('button')[0]!.trigger('click');

    const repositoryLink = wrapper.findAll('.cockpit-view__repositories > div')[1]!.get('a');
    expect(repositoryLink.attributes()).toMatchObject({
      'aria-label': 'Open recent on GitHub',
      href: 'https://github.com/nbonamy/recent',
      rel: 'noreferrer',
      target: '_blank',
    });

    expect(wrapper.emitted('select-work-repository')).toStrictEqual([['nbonamy/recent']]);
    expect(wrapper.findAll('.cockpit-view__repositories > div')[1]!.findAll('button')).toHaveLength(2);

    const allRepositories = Array.from({ length: 12 }, (_, index) => (
      repository(`repository-${index + 1}`, `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
    ));
    await wrapper.setProps({
      workBacklog: {
        ...wrapper.props('workBacklog')!,
        repositories: allRepositories,
        selectedRepositoryId: null,
      },
    });

    expect(wrapper.findAll('.cockpit-view__repositories > div')).toHaveLength(12);

    const activityRepositories = [
      repository('inactive', '2026-08-14T00:00:00.000Z'),
      repository('active', '2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
    ];
    await wrapper.getComponent({ name: 'ElDropdown' }).vm.$emit('command', 'recent');
    await wrapper.setProps({
      workBacklog: {
        ...wrapper.props('workBacklog')!,
        items: [],
        repositories: activityRepositories,
      },
    });

    expect(wrapper.findAll('.cockpit-view__repositories > div').map((row) => row.text())).toStrictEqual(['active', 'inactive']);

    const paginatedRepositories = [
      repository('older', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
      repository('recent', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z'),
    ];
    const firstPageItem = {
      ...item(24),
      sourceId: paginatedRepositories[1]!.id,
      sourceName: paginatedRepositories[1]!.fullName,
      updatedAt: '2026-08-13T12:00:00.000Z',
    };
    const secondPageItem = {
      ...item(25),
      sourceId: paginatedRepositories[0]!.id,
      sourceName: paginatedRepositories[0]!.fullName,
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    await wrapper.setProps({
      workBacklog: {
        ...wrapper.props('workBacklog')!,
        items: [firstPageItem],
        repositories: paginatedRepositories,
      },
    });

    expect(wrapper.findAll('.cockpit-view__repositories > div').map((row) => row.text())).toStrictEqual(['recent', 'older']);

    await wrapper.setProps({
      workBacklog: {
        ...wrapper.props('workBacklog')!,
        items: [secondPageItem],
      },
    });

    expect(wrapper.findAll('.cockpit-view__repositories > div').map((row) => row.text())).toStrictEqual(['recent', 'older']);

    // Repository timestamps still provide recency if optional issue enrichment is unavailable.
    await wrapper.setProps({ workBacklog: { ...wrapper.props('workBacklog')!, repositories:
      paginatedRepositories.map(({ workItemsUpdatedAt, ...source }) => source),
    } });
    expect(wrapper.findAll('.cockpit-view__repositories > div').map(row => row.text())).toStrictEqual(['recent', 'older']);
  });

  it('routes assigned rows to their team and passes the batch launcher to the inbox', () => {
    const snapshot = createInitialSnapshot();
    const assigned = item(24);
    const ready = item(25);
    snapshot.workBacklog.assignments[workItemAssignmentKey(assigned)] = {
      provider: 'github', itemId: assigned.id, agentId: 'agent-dina', assignedAt: '2026-08-12T00:00:00.000Z', policy: 'review', status: 'readyForReview',
    };
    const startWorkItemsAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountView(snapshot, [assigned, ready], [], startWorkItemsAction);
    const inbox = wrapper.findComponent(CockpitWorkInbox);

    inbox.vm.$emit('select-assigned-agent', 'agent-dina');

    expect(wrapper.emitted('select-agent')).toStrictEqual([[{ agentId: 'agent-dina', teamId: 'team-app' }]]);
    expect(inbox.props('startWorkAction')).toBe(startWorkItemsAction);
    expect(inbox.props('defaultTeamId')).toBe('team-app');
  });

  it('summarizes assignments as clickable working, blocked, and review filters', async () => {
    const snapshot = createInitialSnapshot();
    const working = item(24);
    const blocked = item(25);
    const review = item(26);
    snapshot.workBacklog.assignments = {
      [workItemAssignmentKey(working)]: { provider: 'github', itemId: working.id, agentId: 'agent-dina', assignedAt: '2026-08-12T00:00:00.000Z', policy: 'review', status: 'inProgress' },
      [workItemAssignmentKey(blocked)]: { provider: 'github', itemId: blocked.id, agentId: 'agent-jesse', assignedAt: '2026-08-12T00:00:00.000Z', policy: 'review', status: 'blocked' },
      [workItemAssignmentKey(review)]: { provider: 'github', itemId: review.id, agentId: 'agent-dina', assignedAt: '2026-08-12T00:00:00.000Z', policy: 'review', status: 'readyForReview' },
    };
    const wrapper = mountView(snapshot, [working, blocked, review]);

    const summary = wrapper.get('[aria-label="Work summary filters"]');
    expect(summary.get('[data-tone="working"] span').text()).toBe('working');
    expect(summary.get('[data-tone="working"] strong').text()).toBe('1');
    expect(summary.get('[data-tone="blocked"] span').text()).toBe('blocked');
    expect(summary.get('[data-tone="blocked"] strong').text()).toBe('1');
    expect(summary.get('[data-tone="review"] span').text()).toBe('ready for review');
    expect(summary.get('[data-tone="review"] strong').text()).toBe('1');

    await summary.get('[data-tone="working"]').trigger('click');
    expect(wrapper.findComponent(CockpitWorkInbox).props()).toMatchObject({ activeView: 'wip', statusFilter: 'inProgress' });

    await summary.get('[data-tone="blocked"]').trigger('click');
    expect(wrapper.findComponent(CockpitWorkInbox).props()).toMatchObject({ activeView: 'focus', statusFilter: 'blocked' });

    wrapper.findComponent(CockpitWorkInbox).vm.$emit('update-active-view', 'all');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(CockpitWorkInbox).props()).toMatchObject({ activeView: 'all', statusFilter: null });
  });

  it('shows a provider connection empty state', () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(BacklogView, {
      props: { agents: snapshot.agents, teams: snapshot.teams, startWorkItemsAction: vi.fn().mockResolvedValue(undefined), saveRepositoryFavorites: async () => {} },
      global: { stubs: { CockpitWorkInbox: true } },
    });
    expect(wrapper.text()).toContain('Connect a work provider');
  });
});

function mountView(
  snapshot: ReturnType<typeof createInitialSnapshot>,
  items: WorkItem[],
  repositories: WorkSource[] = [],
  startWorkItemsAction = vi.fn().mockResolvedValue(undefined),
  selectedRepositoryId: string | null = null,
  attachTo?: HTMLElement,
) {
  const saveRepositoryFavorites = vi.fn(async (repositoryFavorites: string[]): Promise<void> => {
    await wrapper.setProps({ repositoryFavorites });
  });
  const wrapper = mount(BacklogView, {
    attachTo,
    props: {
      agents: snapshot.agents, teams: snapshot.teams,
      defaultTeamId: snapshot.activeTeamId,
      startWorkItemsAction,
      saveRepositoryFavorites,
      workBacklog: {
        assignments: snapshot.workBacklog.assignments,
        connection: { provider: 'github', status: 'connected', accountLabel: 'nbonamy' },
        error: null, globalScope: 'all', items, repositories, selectedRepositoryId, status: 'loaded',
      },
    },
    global: { stubs: { CockpitWorkInbox: true } },
  });
  return wrapper;
}

function repository(name: string, updatedAt: string, workItemsUpdatedAt?: string): WorkSource {
  return {
    provider: 'github',
    id: `nbonamy/${name}`,
    owner: 'nbonamy',
    name,
    fullName: `nbonamy/${name}`,
    url: `https://github.com/nbonamy/${name}`,
    isPrivate: true,
    updatedAt,
    ...(workItemsUpdatedAt ? { workItemsUpdatedAt } : {}),
  };
}

function item(number: number): WorkItem {
  return { provider: 'github', id: `nbonamy/agent-workspace#${number}`, sourceId: 'nbonamy/agent-workspace', sourceName: 'nbonamy/agent-workspace', number, title: `Work item ${number}`, url: `https://github.com/nbonamy/agent-workspace/issues/${number}`, state: 'open', labels: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' };
}
