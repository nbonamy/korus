import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReviewFindingList, { type ReviewFindingListItem } from '../ReviewFindingList.vue';

const findings: ReviewFindingListItem[] = [
  { id: 'p0', priority: 'p0', title: 'Critical', body: 'Critical body', selected: true, state: 'fixed', stateLabel: 'Fixed', evidence: 'Tests pass.' },
  { id: 'p1', priority: 'p1', title: 'Urgent', body: 'Urgent body', selected: true, state: 'fixing', stateLabel: 'Fixing' },
  { id: 'p2', priority: 'p2', title: 'Normal', body: 'Normal body', selected: false, state: 'skipped', stateLabel: 'Skipped' },
  { id: 'p3', priority: 'p3', title: 'Low', body: 'Low body', selected: true, state: 'open' },
];

describe('ReviewFindingList', () => {
  it('owns the shared expandable finding presentation and selection contract', async () => {
    const wrapper = mount(ReviewFindingList, { props: { findings, selectable: true } });
    expect(wrapper.findAll('.review-finding__priority').map(node => node.text())).toStrictEqual(['P0', 'P1', 'P2', 'P3']);
    await wrapper.findAll('.review-finding__toggle')[0]!.trigger('click');
    expect(wrapper.text()).toContain('Critical body');
    expect(wrapper.text()).toContain('Tests pass.');
    await wrapper.findAll('.review-finding__selection')[1]!.trigger('click');
    expect(wrapper.emitted('select')?.[0]).toStrictEqual(['p1', false]);
  });

  it('styles priority and remediation badges consistently for every parent workflow', () => {
    const wrapper = mount(ReviewFindingList, { props: { findings } });
    expect(wrapper.findAll('.review-finding__priority').map(node => {
      const style = getComputedStyle(node.element);
      return [style.color, style.backgroundColor];
    })).toStrictEqual([
      ['var(--color-on-error)', 'var(--color-error)'],
      ['var(--color-error)', 'var(--color-error-container)'],
      ['var(--color-warning)', 'var(--color-warning-container)'],
      ['var(--color-text-muted)', 'var(--color-surface-high)'],
    ]);
    expect(wrapper.findAll('.review-finding__state').map(node => {
      const style = getComputedStyle(node.element);
      return [style.color, style.backgroundColor];
    })).toStrictEqual([
      ['var(--color-success)', 'var(--color-success-container)'],
      ['var(--color-primary)', 'var(--color-primary-container)'],
      ['var(--color-text-muted)', 'var(--color-surface-high)'],
    ]);
  });
});
