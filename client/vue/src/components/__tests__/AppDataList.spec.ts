import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppDataList from '../AppDataList.vue';

describe('AppDataList', () => {
  it('renders a section header, custom cells, and row actions', () => {
    const wrapper = mount(AppDataList, {
      props: {
        title: 'Current',
        columns: [{
          id: 'name',
          label: 'Name',
          width: 'minmax(0, 1fr)',
        }, {
          id: 'schedule',
          label: 'Schedule',
          width: 'max-content',
          align: 'end',
        }],
        rows: [{
          id: 'automation-bugs',
          name: 'GitHub bugs',
          schedule: 'Every few minutes',
        }],
      },
      slots: {
        headerActions: '<button type="button">New Automation</button>',
        'cell-name': '<template #default="{ row }"><strong>{{ row.name }}</strong></template>',
        actions: '<template #default="{ row }"><button type="button" :aria-label="`Edit ${row.id}`">Edit</button></template>',
      },
    });

    expect(wrapper.text()).toContain('Current');
    expect(wrapper.text()).toContain('New Automation');
    expect(wrapper.text()).toContain('GitHub bugs');
    expect(wrapper.text()).toContain('Every few minutes');
    expect(wrapper.find('[aria-label="Edit automation-bugs"]').exists()).toBe(true);
  });

  it('renders column headers, subtitles, default cells, and explicit aria labels', () => {
    const wrapper = mount(AppDataList, {
      props: {
        ariaLabel: 'Automation runs',
        showColumnHeader: true,
        subtitle: 'Recent executions',
        title: 'History',
        columns: [{
          id: 'ticket',
          label: 'Ticket',
        }, {
          id: 'startedAt',
          label: 'Started',
          align: 'end',
        }],
        rows: [{
          id: 'run-1',
          ticket: 'github:nbonamy/agent-workspace#12',
          startedAt: 'Jun 9, 10:47 PM',
        }],
      },
    });

    expect(wrapper.attributes('aria-label')).toBe('Automation runs');
    expect(wrapper.text()).toContain('Recent executions');
    expect(wrapper.text()).toContain('Ticket');
    expect(wrapper.text()).toContain('Started');
    expect(wrapper.text()).toContain('github:nbonamy/agent-workspace#12');
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(2);
    expect(wrapper.find('[data-align="end"]').text()).toBe('Started');
  });

  it('renders empty states with and without custom content', () => {
    const wrapper = mount(AppDataList, {
      props: {
        columns: [{
          id: 'name',
          label: 'Name',
        }],
        emptyText: 'No executions yet',
        rows: [],
      },
    });

    expect(wrapper.find('.app-data-list__header').exists()).toBe(false);
    expect(wrapper.text()).toBe('No executions yet');

    const custom = mount(AppDataList, {
      props: {
        columns: [{
          id: 'name',
          label: 'Name',
        }],
        rows: [],
        title: 'Current',
      },
      slots: {
        empty: '<span>Nothing scheduled</span>',
      },
    });

    expect(custom.attributes('aria-label')).toBe('Current');
    expect(custom.text()).toContain('Nothing scheduled');
  });
});
