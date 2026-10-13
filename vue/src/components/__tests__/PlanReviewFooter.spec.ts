import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import PlanReviewFooter from '../PlanReviewFooter.vue';

it('orders Cancel, Revise and Approve and enables revision only with feedback', async () => {
  const wrapper = mount(PlanReviewFooter, { props: { hasFeedback: false } });
  expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Cancel', 'Revise', 'Approve']);
  expect(wrapper.findAll('button')[1]!.attributes('disabled')).toBeDefined();
  await wrapper.setProps({ hasFeedback: true });
  for (const button of wrapper.findAll('button')) await button.trigger('click');
  expect(wrapper.emitted()).toMatchObject({ cancel: [[]], revise: [[]], approve: [[]] });
  await wrapper.setProps({ disabled: true });
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
  await wrapper.setProps({ disabled: false, canApprove: false });
  expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Cancel', 'Revise']);
});
