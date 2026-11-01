import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FormField from '../FormField.vue';

describe('FormField', () => {
  it('labels the control and shows help under the label in the default dialog layout', () => {
    const wrapper = mount(FormField, { props: { label: 'Folder', labelFor: 'folder', help: 'Pick one' }, slots: { default: '<input id="folder">' } });
    expect(wrapper.get('label').attributes('for')).toBe('folder');
    const order = [...wrapper.element.querySelectorAll('label, p, input')].map(node => node.tagName);
    expect(order).toEqual(['LABEL', 'P', 'INPUT']);
  });

  it('puts help after the control in the compact layout and renders an unbound label as text', () => {
    const wrapper = mount(FormField, { props: { label: 'Days', help: 'Pick days', density: 'compact' }, slots: { default: '<div role="group">x</div>', feedback: '<em>err</em>' } });
    expect(wrapper.find('label').exists()).toBe(false);
    const order = [...wrapper.element.querySelectorAll('span, [role="group"], p, em')].map(node => node.tagName);
    expect(order).toEqual(['SPAN', 'DIV', 'P', 'EM']);
  });
});
