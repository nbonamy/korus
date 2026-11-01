import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CodeSelectionAnnotation from '../CodeSelectionAnnotation.vue';
import type { CodeSelection } from '../use-code-selection';

const selection: CodeSelection = { path: 'src/billing.ts', startLine: 2, endLine: 3, side: 'new', text: 'a\nb', anchor: { x: 40, y: 60, width: 100, height: 20 } };
const Popup = { name: 'AnnotationPopup', props: ['anchor', 'description', 'label', 'placeholder', 'submitLabel', 'strategy'], emits: ['submit', 'cancel'], template: '<form class="popup" />' };
const mountIt = (value: CodeSelection | null) => mount(CodeSelectionAnnotation, { props: { selection: value }, global: { stubs: { AnnotationPopup: Popup } } });

describe('CodeSelectionAnnotation', () => {
  it('offers to annotate a selection, naming the file and lines in the comment popup', async () => {
    const wrapper = mountIt(selection);
    await wrapper.get('.code-selection-annotation__add').trigger('click');
    expect(wrapper.find('.code-selection-annotation__add').exists()).toBe(false);
    const popup = wrapper.getComponent(Popup);
    expect(popup.props('description')).toBe('src/billing.ts lines 2-3');
    expect(popup.props('anchor')).toStrictEqual(selection.anchor);
    expect(popup.props('submitLabel')).toBe('Add annotation');
  });

  it('hands the selection and comment to the host, then asks to dismiss the selection', async () => {
    const wrapper = mountIt(selection);
    await wrapper.get('.code-selection-annotation__add').trigger('click');
    wrapper.getComponent(Popup).vm.$emit('submit', 'Guard this.');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('save')).toStrictEqual([[{ selection, comment: 'Guard this.' }]]);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(wrapper.findComponent(Popup).exists()).toBe(false);
  });

  it('cancels back to nothing, and shows nothing without a selection', async () => {
    const wrapper = mountIt(selection);
    await wrapper.get('.code-selection-annotation__add').trigger('click');
    wrapper.getComponent(Popup).vm.$emit('cancel');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
    expect(mountIt(null).find('.code-selection-annotation__add').exists()).toBe(false);
  });

  it('drops a comment in progress when the selection moves somewhere else', async () => {
    const wrapper = mountIt(selection);
    await wrapper.get('.code-selection-annotation__add').trigger('click');
    await wrapper.setProps({ selection: { ...selection, startLine: 9, endLine: 9 } });
    expect(wrapper.findComponent(Popup).exists()).toBe(false);
  });
});
