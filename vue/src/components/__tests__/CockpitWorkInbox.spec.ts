import type { BackendModelOption } from '@workspace/core/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { computed } from 'vue';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import { backendSnapshotKey } from '../backend-selection';
import { backendModelCatalogKey } from '../backend-model-catalog';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, RemoteConnection, WorkBacklogAssignment, WorkItem } from '@workspace/core/contracts';
import { workItemAssignmentKey } from '@workspace/core/work-assignments';
import CockpitWorkInbox from '../CockpitWorkInbox.vue';

describe('CockpitWorkInbox', () => {
  it('offers ready hosts between team and model and starts work with the selected host model', async () => {
    const selected = item(21, 'Remote work', 'repo-one');
    const start = vi.fn().mockResolvedValue(undefined);
    const connection: RemoteConnection = { id: 'remote-inbox', kind: 'ssh', name: 'Devbox', host: 'devbox', status: 'ready',
      providerConnections: [{ backend: 'claude', installed: true, connected: true, checking: false }], createdAt: '', updatedAt: '' };
    const wrapper = mountInbox([selected], {}, {}, start, undefined, [connection]);
    await wrapper.get('[aria-label="Start work on #21"]').trigger('click');
    await flushPromises();
    const fields = wrapper.findAll('.cockpit-inbox__start-body > label');
    expect(fields.map(field => field.element.firstChild?.textContent?.trim())).toEqual(['Team', 'Host', 'Agent']);
    const options = wrapper.get('[aria-label="Host"]').findAll('option');
    expect(options[0]!.find('.tabler-icon-device-imac').exists()).toBe(true);
    expect(options[1]!.find('.tabler-icon-world').exists()).toBe(true);
    await wrapper.get('[aria-label="Host"] select').setValue(connection.id);
    await flushPromises();
    await wrapper.get('.app-dialog__footer .app-button--primary').trigger('click');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ remoteConnectionId: connection.id, selection: expect.objectContaining({ backend: 'claude' }) }));
  });

  it('hides host selection when no remote connection is ready', async () => {
    const wrapper = mountInbox([item(21, 'Local work', 'repo-one')]);
    await wrapper.setProps({ remoteConnections: [{ id: 'unavailable', kind: 'ssh', name: 'Devbox', host: 'devbox', status: 'error', createdAt: '', updatedAt: '' }] });
    await wrapper.get('[aria-label="Start work on #21"]').trigger('click');
    expect(wrapper.find('[aria-label="Host"]').exists()).toBe(false);
  });

  it('launches just the clicked ticket with the chosen model without changing the batch selection', async () => {
    const first = item(21, 'First work', 'repo-one');
    const second = item(22, 'Second work', 'repo-two');
    let finish!: () => void;
    const start = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const wrapper = mountInbox([first, second], {}, {}, start);
    await wrapper.findAll('.cockpit-inbox__selection input')[0]!.setValue(true);
    const row = wrapper.findAll('.cockpit-inbox__row')[1]!;
    expect(row.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
      'View #22', 'Start work on #22', 'More actions for #22',
    ]);
    await row.get('[aria-label="Start work on #22"]').trigger('click');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    (Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent?.includes('GPT Fast'))!).click();
    await flushPromises();
    await wrapper.findAll('.app-dialog__footer button').find(button => button.text() === 'Fix')!.trigger('click');
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ items: [second], selection: { backend: 'codex', model: 'gpt-fast', reasoningEffort: null, serviceTier: null } }));
    expect(wrapper.find('.cockpit-inbox__start-dialog').exists()).toBe(false);
    finish();
    await flushPromises();
    expect(wrapper.findAll<HTMLInputElement>('.cockpit-inbox__selection input')[0]!.element.checked).toBe(true);
  });
  it('checks feedback for authored PRs and reviews other PRs while retaining the address-feedback action', async () => {
    const own = { ...item(21, 'My PR', 'repo-one'), kind: 'pullRequest' as const, authorName: 'NICOLAS' };
    const other = { ...item(22, 'Other PR', 'repo-two'), kind: 'pullRequest' as const, authorName: 'someone-else' };
    const start = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountInbox([own, other], {}, { activeView: 'all' }, start);
    await wrapper.get('[aria-label="Check feedback on #21"]').trigger('click');
    await wrapper.get('.app-dialog__footer .app-button--primary').trigger('click');
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'checkFeedback', items: [own] }));
    await flushPromises();
    await wrapper.get('[aria-label="Check feedback on #21"]').trigger('click');
    const address = wrapper.get('.app-dialog__footer .app-button--secondary');
    expect(address.text()).toBe('Address feedback');
    await address.trigger('click');
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'addressFeedback', items: [own] }));
    await flushPromises();
    await wrapper.get('[aria-label="Start work on #22"]').trigger('click');
    expect(wrapper.get('.app-dialog__footer .app-button--primary').text()).toBe('Review');
    await wrapper.get('.app-dialog__footer .app-button--primary').trigger('click');
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'review', items: [other] }));
  });
  it('requires an explicit code repository for Linear batches and invalidates a submitted selection on source change', async () => {
    const selected = { ...item(12, 'Repair login', 'linear:team'), provider: 'linear' as const, id: 'linear:uuid', identifier: 'ENG-12' };
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const repository = { name: 'code', path: '/remote/code', worktrees: [] };
    const listSourceRepositories = vi.fn().mockResolvedValue([repository]);
    const wrapper = mountInbox([selected], {}, {}, startWorkAction);
    await wrapper.setProps({ connection: { provider: 'linear', status: 'connected' }, listSourceRepositories,
      teams: [{ id: 'team-one', name: 'Remote', agentIds: [] }] });
    await wrapper.get('.cockpit-inbox__selection input').setValue(true);
    await wrapper.get('.cockpit-inbox__start-work').trigger('click');
    await flushPromises();
    expect(listSourceRepositories).toHaveBeenCalledWith();
    const fix = wrapper.findAll('.app-dialog__footer button').find(button => button.text() === 'Fix')!;
    await fix.trigger('click');
    expect(startWorkAction).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Code repository"] select').setValue(repository.path);
    await fix.trigger('click');
    const input = startWorkAction.mock.calls[0]![0];
    expect(input).toMatchObject({ items: [selected], repository, teamId: 'team-one', action: 'fix' });
    await wrapper.setProps({ selectedRepositoryId: 'linear:other' });
    expect(input.isCurrent()).toBe(false);
  });
  it('defaults to Focus and preserves the view order while prioritizing attention and review', async () => {
    const blocked = item(21, 'Resolve a blocker', 'repo-one');
    const review = item(22, 'Review the result', 'repo-two');
    const ready = item(23, 'Start this next', 'repo-one');
    const wrapper = mountInbox([blocked, review, ready], {
      [workItemAssignmentKey(blocked)]: assignment(blocked, 'agent-one', 'blocked'),
      [workItemAssignmentKey(review)]: assignment(review, 'agent-two', 'readyForReview'),
    });

    expect(wrapper.findAll('.cockpit-inbox__view-label').map((label) => label.text())).toStrictEqual([
      'All', 'Backlog', 'WIP', 'Focus',
    ]);
    expect(wrapper.findAll('.cockpit-inbox__view-count').map((count) => count.text())).toStrictEqual(['3', '1', '2', '2']);
    expect(wrapper.findAll('.cockpit-inbox__views > button')[3]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Needs attention');
    expect(wrapper.text()).toContain('Ready for review');
    expect(wrapper.text()).not.toContain('Start this next');

    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');
    expect(wrapper.text()).toContain('Start this next');
    expect(wrapper.findAll('.cockpit-inbox__group > header strong').map((header) => header.text())).toStrictEqual([
      'Needs attention', 'Ready for review', 'Ready',
    ]);
  });

  it('falls back from Focus to WIP and Backlog, including after a repository load', async () => {
    const working = item(21, 'Working item', 'repo-one');
    const ready = item(22, 'Ready item', 'repo-two');
    const blocked = item(23, 'Blocked item', 'repo-one');
    const wrapper = mountInbox([working], {
      [workItemAssignmentKey(working)]: assignment(working, 'agent-one', 'inProgress'),
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.cockpit-inbox__views > button')[2]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('update-active-view')?.at(-1)).toStrictEqual(['wip']);

    await wrapper.setProps({ selectedRepositoryId: 'repo-two', globalScope: null, status: 'loading' });
    await wrapper.setProps({ items: [ready], assignments: {}, status: 'loaded' });
    expect(wrapper.findAll('.cockpit-inbox__views > button')[1]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('update-active-view')?.at(-1)).toStrictEqual(['backlog']);

    await wrapper.setProps({ selectedRepositoryId: 'repo-one', globalScope: null, status: 'loading' });
    await wrapper.setProps({
      items: [blocked],
      assignments: { [workItemAssignmentKey(blocked)]: assignment(blocked, 'agent-one', 'blocked') },
      status: 'loaded',
    });
    expect(wrapper.findAll('.cockpit-inbox__views > button')[3]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.emitted('update-active-view')?.at(-1)).toStrictEqual(['focus']);
  });

  it('returns completed assignments to Backlog without breaking the view counts', async () => {
    const completed = item(21, 'Completed item', 'repo-one');
    const ready = item(22, 'Ready item', 'repo-two');
    const wrapper = mountInbox([completed, ready], {
      [workItemAssignmentKey(completed)]: assignment(completed, 'agent-one', 'completed'),
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.cockpit-inbox__view-count').map((count) => count.text())).toStrictEqual(['2', '2', '0', '0']);
    expect(wrapper.findAll('.cockpit-inbox__views > button')[1]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('Ready item');
    expect(wrapper.text()).toContain('Completed item');
    expect(wrapper.findAll('.cockpit-inbox__row-action').filter(button => button.attributes('aria-label')?.startsWith('View ')).map((button) => button.attributes('aria-label'))).toStrictEqual([
      'View #21', 'View #22',
    ]);
  });

  it('isolates backlog and WIP and routes assigned and unassigned rows', async () => {
    const assigned = item(21, 'Assigned work', 'repo-one');
    const ready = item(22, 'Ready work', 'repo-two');
    const wrapper = mountInbox([assigned, ready], {
      [workItemAssignmentKey(assigned)]: assignment(assigned, 'agent-one', 'inProgress'),
    });

    await wrapper.findAll('.cockpit-inbox__views > button')[1]?.trigger('click');
    expect(wrapper.text()).toContain('Ready work');
    expect(wrapper.text()).not.toContain('Assigned work');
    await wrapper.get('.cockpit-inbox__row').trigger('click');
    expect(wrapper.getComponent({ name: 'ElCheckbox' }).props('modelValue')).toBe(true);

    await wrapper.findAll('.cockpit-inbox__views > button')[2]?.trigger('click');
    expect(wrapper.text()).toContain('Assigned work');
    expect(wrapper.text()).not.toContain('Ready work');
    await wrapper.get('.cockpit-inbox__row').trigger('click');
    expect(wrapper.emitted('select-assigned-agent')).toStrictEqual([['agent-one']]);
  });

  it('keeps view and start inline and tucks the provider link into an overflow menu', async () => {
    const assigned = item(21, 'Assigned work', 'repo-one');
    const ready = item(22, 'Ready work', 'repo-two');
    const wrapper = mountInbox([assigned, ready], {
      [workItemAssignmentKey(assigned)]: assignment(assigned, 'agent-one', 'inProgress'),
    }, { activeView: 'all' });
    const rows = wrapper.findAll('.cockpit-inbox__row');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    expect(rows[0]?.get('.cockpit-inbox__row-action').attributes('aria-label')).toBe('View #21');
    expect(rows[0]?.get('.cockpit-inbox__row-action').find('.tabler-icon-file-text').exists()).toBe(true);
    expect(rows[1]?.get('.cockpit-inbox__row-action').attributes('aria-label')).toBe('View #22');
    expect(wrapper.find('details').exists()).toBe(false);

    await rows[0]?.get('.cockpit-inbox__row-action').trigger('click');
    expect(wrapper.get('.work-item-detail').text()).toContain('Assigned work');
    expect(wrapper.emitted('select-assigned-agent')).toBeUndefined();
    await rows[1]?.get('.cockpit-inbox__row-action').trigger('click');
    await rows[0]?.get('[aria-label="More actions for #21"]').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.app-menu__item')!.click();
    await flushPromises();

    expect(wrapper.emitted('select-assigned-agent')).toBeUndefined();
    expect(wrapper.get('.work-item-detail').text()).toContain('Ready work');
    expect(open).toHaveBeenCalledWith(assigned.url, '_blank', 'noreferrer');
    open.mockRestore();
  });

  it('applies a KPI status filter inside the selected view', async () => {
    const working = item(21, 'Working item', 'repo-one');
    const blocked = item(22, 'Blocked item', 'repo-two');
    const wrapper = mountInbox([working, blocked], {
      [workItemAssignmentKey(working)]: assignment(working, 'agent-one', 'inProgress'),
      [workItemAssignmentKey(blocked)]: assignment(blocked, 'agent-two', 'blocked'),
    }, { activeView: 'focus', statusFilter: 'blocked' });

    expect(wrapper.text()).toContain('Blocked item');
    expect(wrapper.text()).not.toContain('Working item');

    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');
    expect(wrapper.emitted('update-active-view')).toStrictEqual([['all']]);
  });

  it('keeps repository identity scannable across repositories and forwards filters', async () => {
    const wrapper = mountInbox([item(21, 'First repo work', 'repo-one'), item(22, 'Second repo work', 'repo-two')]);
    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');

    expect(wrapper.text()).toContain('repo-one #21');
    expect(wrapper.text()).toContain('repo-two #22');
    await wrapper.get('.cockpit-inbox__filter-button').trigger('click');
    const selects = wrapper.findAllComponents({ name: 'ElSelect' }).filter((select) => select.attributes('aria-label') !== 'Item type');
    await selects[0]?.vm.$emit('update:modelValue', 'repo-two');
    await selects[1]?.vm.$emit('update:modelValue', 'bug');
    await selects[2]?.vm.$emit('update:modelValue', 'nicolas');
    expect(wrapper.emitted('select-repository')).toStrictEqual([['repo-two']]);
    expect(wrapper.emitted('select-tag')).toStrictEqual([['bug']]);
    expect(wrapper.emitted('select-assignee')).toStrictEqual([['nicolas']]);
  });

  it('shows the default assigned-to-me scope as an active assignee filter', async () => {
    const wrapper = mountInbox([item(21, 'Mine', 'repo-one')], {}, { globalScope: 'assignedToMe' });
    const filterButton = wrapper.get('.cockpit-inbox__filter-button');
    expect(filterButton.text()).toContain('1');
    await filterButton.trigger('click');
    const assignee = wrapper.findAllComponents({ name: 'ElSelect' }).filter((select) => select.attributes('aria-label') !== 'Item type')[2]!;
    expect(assignee.props('modelValue')).toBe('@me');
    await assignee.vm.$emit('update:modelValue', null);
    expect(wrapper.emitted('select-assignee')).toStrictEqual([[null]]);
    await assignee.vm.$emit('update:modelValue', '@me');
    expect(wrapper.emitted('select-global-scope')).toStrictEqual([['assignedToMe']]);

    const everyone = mountInbox([item(21, 'Mine', 'repo-one')], {}, { globalScope: 'all' });
    expect(everyone.get('.cockpit-inbox__filter-button').text()).not.toContain('1');
  });

  it('filters by item type only when the provider has pull requests', async () => {
    const pullRequest = { ...item(31, 'Fix the parser', 'repo-one'), kind: 'pullRequest' as const };
    const offPage = item(99, 'Assignment outside this page', 'repo-two');
    const wrapper = mountInbox([item(30, 'Parser crashes', 'repo-one'), pullRequest], {
      [workItemAssignmentKey(pullRequest)]: assignment(pullRequest, 'agent-one', 'readyForReview'),
      [workItemAssignmentKey(offPage)]: assignment(offPage, 'agent-two', 'blocked'),
    });
    const counts = () => wrapper.findAll('.cockpit-inbox__view-count').map(count => count.text());
    expect(counts()).toStrictEqual(['2', '1', '1', '1']);
    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');
    const typeFilter = () => wrapper.findAllComponents({ name: 'ElSelect' }).find((select) => select.attributes('aria-label') === 'Item type')!;
    expect(wrapper.findAll('.cockpit-inbox__row')).toHaveLength(2);
    await typeFilter().vm.$emit('update:modelValue', ['pullRequest']);
    expect(wrapper.findAll('.cockpit-inbox__row')).toHaveLength(1);
    expect(wrapper.text()).toContain('Fix the parser');
    expect(counts()).toStrictEqual(['1', '0', '1', '1']);
    await typeFilter().vm.$emit('update:modelValue', ['issue']);
    expect(wrapper.text()).toContain('Parser crashes');
    expect(wrapper.text()).not.toContain('Fix the parser');
    expect(counts()).toStrictEqual(['1', '1', '0', '0']);
    await wrapper.findAll('.cockpit-inbox__views > button')[2]!.trigger('click');
    expect(wrapper.findAll('.cockpit-inbox__row')).toHaveLength(0);
    expect(wrapper.text()).toContain('No work in WIP');
    await wrapper.findAll('.cockpit-inbox__views > button')[0]!.trigger('click');
    await typeFilter().vm.$emit('update:modelValue', []);
    expect(wrapper.findAll('.cockpit-inbox__row')).toHaveLength(2);

    await wrapper.setProps({ connection: { provider: 'linear', status: 'connected' } });
    expect(wrapper.find('[aria-label="Item type"]').exists()).toBe(false);
  });

  it('collapses an empty search back to its icon on blur and keeps a typed query open', async () => {
    const wrapper = mountInbox([item(40, 'Searchable work', 'repo-one')]);
    await wrapper.get('.cockpit-inbox__icon-button').trigger('click');
    await wrapper.vm.$nextTick();
    const input = () => wrapper.get('input.cockpit-inbox__search-input');
    await input().trigger('blur');
    expect(wrapper.find('.cockpit-inbox__search-input').exists()).toBe(false);
    await wrapper.get('.cockpit-inbox__icon-button').trigger('click');
    await wrapper.vm.$nextTick();
    await input().setValue('search');
    await input().trigger('blur');
    expect(wrapper.find('.cockpit-inbox__search-input').exists()).toBe(true);
  });

  it('opens the item in its provider from the row overflow menu without selecting the row', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountInbox([item(42, 'Overflow work', 'repo-one')]);
    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');
    await wrapper.get('[aria-label="More actions for #42"]').trigger('click');
    expect(document.body.querySelector('.app-menu__item')!.textContent).toContain('View in GitHub');
    document.body.querySelector<HTMLButtonElement>('.app-menu__item')!.click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith(expect.stringContaining('/repo-one/issues/42'), '_blank', 'noreferrer');
    expect(wrapper.get<HTMLInputElement>('.cockpit-inbox__selection input').element.checked).toBe(false);
    open.mockRestore();
  });

  it('selects visible work and confirms a batch action and team', async () => {
    const first = item(21, 'First repo work', 'repo-one');
    const second = item(22, 'Second repo work', 'repo-two');
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountInbox([first, second], {}, {}, startWorkAction);

    const startButton = wrapper.findAllComponents({ name: 'ElButton' }).find((button) => button.text().includes('Start work'))!;
    expect(startButton.props('disabled')).toBe(true);

    await wrapper.get('[aria-label="Search work"]').trigger('click');
    await wrapper.get('input[aria-label="Search work"]').setValue('second');
    await wrapper.findAll('.cockpit-inbox__views > button')[0]?.trigger('click');
    expect(wrapper.text()).toContain('Second repo work');
    expect(wrapper.text()).not.toContain('First repo work');

    await wrapper.get('.cockpit-inbox__row').trigger('click');
    expect(startButton.props('disabled')).toBe(false);
    await startButton.trigger('click');
    expect(wrapper.get('.cockpit-inbox__start-body').text()).toContain('Launch 1 agent?');
    const clientNavigationSelectTeam = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('aria-label') === 'Team for new agents')!;
    expect(clientNavigationSelectTeam.props('modelValue')).toBe('team-one');
    await clientNavigationSelectTeam.vm.$emit('update:modelValue', 'team-two');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.includes('Claude Code'))!.click();
    await flushPromises();

    await wrapper.findAll('.app-dialog__footer button').find((button) => button.text() === 'Investigate')?.trigger('click');
    expect(startWorkAction).toHaveBeenCalledWith({ action: 'investigate', items: [second], teamId: 'team-two', selection: { backend: 'claude', model: 'gpt-fast', reasoningEffort: null, serviceTier: null } });
  });

  it('starts agents on the service tier chosen with the model', async () => {
    const second = item(22, 'Second repo work', 'repo-two');
    const startWorkAction = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountInbox([second], {}, {}, startWorkAction, [
      { id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast', serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }, { id: 'ultrafast', name: 'Ultrafast', description: '' }] },
    ]);
    await wrapper.get('.cockpit-inbox__row').trigger('click');
    await wrapper.findAllComponents({ name: 'ElButton' }).find((button) => button.text().includes('Start work'))!.trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(row => row.textContent?.trim() === 'ultrafast')!.click();
    await flushPromises();
    await wrapper.findAll('.app-dialog__footer button').find((button) => button.text() === 'Investigate')?.trigger('click');
    expect(startWorkAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'investigate', items: [second], selection: expect.objectContaining({ model: 'gpt-fast', serviceTier: 'ultrafast' }) }));
  });

  it('guides unfiltered global views before loading cross-repository work', async () => {
    const wrapper = mountInbox([], {}, { activeView: 'all', globalScope: null });

    expect(wrapper.get('.cockpit-inbox__scope').text()).toContain('select a repository from the sidebar');
    expect(wrapper.text()).toContain('Show items assigned to me');
    expect(wrapper.text()).toContain('Load everything');

    const buttons = wrapper.findAll('.cockpit-inbox__scope-actions button');
    await buttons[0]?.trigger('click');
    await buttons[1]?.trigger('click');
    expect(wrapper.emitted('select-global-scope')).toStrictEqual([['assignedToMe'], ['all']]);
  });

  it('keeps the global total in pagination while tab counts reflect this page', async () => {
    const wrapper = mountInbox([item(21, 'First page work', 'repo-one')], {}, {
      activeView: 'all',
      globalScope: 'all',
      page: 1,
      pageSize: 5,
      hasNextPage: true,
      totalItems: 11,
    });

    expect(wrapper.get('.cockpit-inbox__pagination').text()).toContain('11 items total');
    expect(wrapper.get('.cockpit-inbox__pagination').text()).toContain('Page 1');
    expect(wrapper.findAll('.cockpit-inbox__view-count')[0]?.text()).toBe('1');
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Previous page"]').element.disabled).toBe(true);
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Next page"]').element.disabled).toBe(false);
    await wrapper.get('[aria-label="Next page"]').trigger('click');
    expect(wrapper.emitted('change-page')).toStrictEqual([[2]]);

    await wrapper.setProps({ pageLoading: true });
    expect(wrapper.get<HTMLButtonElement>('[aria-label="Next page"]').element.disabled).toBe(true);
  });
});

function mountInbox(
  items: WorkItem[],
  assignments: Record<string, WorkBacklogAssignment> = {},
  filters: { activeView?: 'all' | 'backlog' | 'wip' | 'focus'; globalScope?: 'assignedToMe' | 'all' | null; page?: number; hasNextPage?: boolean; pageLoading?: boolean; pageSize?: number; statusFilter?: 'inProgress' | 'blocked' | 'readyForReview' | null; totalItems?: number } = {},
  startWorkAction = vi.fn().mockResolvedValue(undefined),
  models: BackendModelOption[] = [{ id: 'fast', model: 'gpt-fast', displayName: 'GPT Fast' }],
  remoteConnections: RemoteConnection[] = [],
) {
  return mount(CockpitWorkInbox, {
    global: { provide: {
      [backendSnapshotKey as symbol]: () => ({
        ...createEmptySnapshot(),
        providerConnections: (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false })),
        remoteConnections: { connections: remoteConnections },
        teams: [{ id: 'team-one', name: 'Team One', agentIds: ['agent-one'] }],
        agents: [agent('agent-one', 'Dina')],
      }),
      [backendModelCatalogKey as symbol]: { listModels: vi.fn(async () => models) },
    } },
    props: {
      agents: [agent('agent-one', 'Dina'), agent('agent-two', 'Jesse')], assignments,
      connection: { provider: 'github', status: 'connected', accountLabel: 'nicolas' },
      error: null, items,
      repositories: [
        { provider: 'github', id: 'repo-one', owner: 'owner', name: 'repo-one', fullName: 'owner/repo-one', url: 'https://github.com/owner/repo-one', isPrivate: false },
        { provider: 'github', id: 'repo-two', owner: 'owner', name: 'repo-two', fullName: 'owner/repo-two', url: 'https://github.com/owner/repo-two', isPrivate: false },
      ],
      globalScope: 'all', selectedRepositoryId: null, status: 'loaded', totalItems: items.length,
      teams: [
        { id: 'team-one', name: 'Team One', agentIds: [] },
        { id: 'team-two', name: 'Team Two', agentIds: [] },
      ],
      defaultTeamId: 'team-one',
      startWorkAction,
      remoteConnections,
      ...filters,
    },
  });
}

function item(number: number, title: string, repositoryId: string): WorkItem {
  return { provider: 'github', id: `owner/${repositoryId}#${number}`, sourceId: repositoryId, sourceName: `owner/${repositoryId}`, number, title, url: `https://github.com/owner/${repositoryId}/issues/${number}`, state: 'open', assignees: ['nicolas'], labels: [{ name: 'bug' }], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' };
}

function assignment(workItem: WorkItem, agentId: string, status: WorkBacklogAssignment['status']): WorkBacklogAssignment {
  return { provider: 'github', itemId: workItem.id, agentId, assignedAt: '2026-08-12T01:00:00.000Z', policy: 'review', status };
}

function agent(id: string, name: string): Agent {
  return { id, teamId: 'team-one', name, avatar: name.slice(0, 2), folder: '/tmp/repo', backend: 'codex', backendDefaults: { kind: 'codex' }, status: { type: 'idle' }, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' };
}
