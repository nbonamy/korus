import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@workspace/core/contracts';
import WorkItemDetail from '../WorkItemDetail.vue';

const item: WorkItem = {
  provider: 'github',
  id: 'github:nbonamy/korus#27',
  sourceId: 'nbonamy/korus',
  sourceName: 'nbonamy/korus',
  number: 27,
  title: 'Add commit actions',
  url: 'https://github.com/nbonamy/korus/issues/27',
  state: 'open',
  kind: 'issue',
  labels: [{ name: 'ux' }],
  assignees: [],
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('WorkItemDetail', () => {
  it('renders the issue body as markdown without trusting raw HTML', () => {
    const wrapper = mount(WorkItemDetail, {
      props: { item: { ...item, body: '## Problem\n\nUse **bold** text.\n\n- [ ] a task\n\n<img src=x onerror="alert(1)">' } },
    });

    const body = wrapper.get('.work-item-detail__body');
    expect(body.get('h2').text()).toBe('Problem');
    expect(body.get('strong').text()).toBe('bold');
    expect(body.find('img').exists()).toBe(false);
    expect(body.text()).toContain('<img src=x');
  });

  it('shows no body section for an issue without a description', () => {
    const wrapper = mount(WorkItemDetail, { props: { item: { ...item, body: '  ' } } });

    expect(wrapper.find('.work-item-detail__body').exists()).toBe(false);
    expect(wrapper.text()).toContain('#27 · Add commit actions');
  });
});
