import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import QuickOpenDialog from '../QuickOpenDialog.vue';

describe('QuickOpenDialog', () => {
  it('presents a grouped shortcut reference with key search and no command activation', async () => {
    const wrapper = mount(QuickOpenDialog, { attachTo: document.body, props: {
      dialogLabel: 'Keyboard shortcuts', inputAriaLabel: 'Search shortcuts', placeholder: 'Search', emptyLabel: 'Empty', readOnly: true,
      items: [
        { id: 'files', label: 'Go to file', keys: ['⌘', 'P'], group: 'Navigation' },
        { id: 'duplicate', label: 'Duplicate agent', keys: ['⌘', 'D'], group: 'Agents' },
      ],
    } });
    await nextTick();
    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.findAll('h3').map(group => group.text())).toStrictEqual(['Navigation', 'Agents']);
    await wrapper.get('input').setValue('cmd+d');
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1);
    expect(wrapper.findAll('kbd').map(key => key.text())).toStrictEqual(['⌘', 'D']);
    await wrapper.get('input').trigger('keydown.enter');
    await wrapper.get('[role="listitem"]').trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
    await wrapper.get('input').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get('[role="list"]').element);
    await wrapper.get('[role="list"]').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(wrapper.get('input').element);
    wrapper.unmount();
  });
  it('keeps keyboard focus inside and clamps selection when context removes results', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const wrapper = mount(QuickOpenDialog, { attachTo: document.body, props: {
      dialogLabel: 'Commands', inputAriaLabel: 'Search', placeholder: 'Search', emptyLabel: 'Empty',
      items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'disabled', label: 'Unavailable', disabled: true }],
    } });
    await nextTick();
    await wrapper.get('input').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(wrapper.findAll('button')[1]!.element);
    await wrapper.findAll('button')[1]!.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(wrapper.get('input').element);
    await wrapper.get('input').trigger('keydown.down');
    await wrapper.setProps({ items: [{ id: 'one', label: 'One' }] });
    await wrapper.get('input').trigger('keydown.enter');
    expect(wrapper.emitted('select')).toStrictEqual([['one']]);
    await wrapper.get('button').trigger('keydown.escape');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('filters items and supports arrow, enter, escape, and backdrop dismissal', async () => {
    const wrapper = mount(QuickOpenDialog, {
      props: {
        dialogLabel: 'Open thing',
        emptyLabel: 'Nothing found',
        inputAriaLabel: 'Search things',
        items: [
          { id: 'one', label: 'One', detail: 'First team' },
          { id: 'two', label: 'Two', detail: 'Second team', searchText: 'special target' },
        ],
        placeholder: 'Search…',
      },
    });

    const input = wrapper.get('input');
    await input.setValue('special');
    expect(wrapper.findAll('.quick-open-dialog__item')).toHaveLength(1);
    await input.trigger('keydown.enter');
    expect(wrapper.emitted('select')).toStrictEqual([['two']]);
    expect(wrapper.emitted('close')).toHaveLength(1);

    await input.setValue('');
    await input.trigger('keydown.down');
    await input.trigger('keydown.enter');
    expect(wrapper.emitted('select')).toStrictEqual([['two'], ['two']]);

    await input.trigger('keydown.escape');
    await wrapper.get('.quick-open-dialog').trigger('mousedown');
    expect(wrapper.emitted('close')).toHaveLength(4);
  });

  it('shows its configured empty state', async () => {
    const wrapper = mount(QuickOpenDialog, {
      props: {
        dialogLabel: 'Open thing',
        emptyLabel: 'Nothing found',
        inputAriaLabel: 'Search things',
        items: [],
        placeholder: 'Search…',
      },
    });

    expect(wrapper.text()).toContain('Nothing found');
  });

  it('scrolls the keyboard-selected item into view', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const wrapper = mount(QuickOpenDialog, {
      props: {
        dialogLabel: 'Open thing',
        emptyLabel: 'Nothing found',
        inputAriaLabel: 'Search things',
        items: [
          { id: 'one', label: 'One' },
          { id: 'two', label: 'Two' },
        ],
        placeholder: 'Search…',
      },
    });

    await wrapper.get('input').trigger('keydown.down');

    expect(wrapper.findAll('.quick-open-dialog__item')[1]!.classes()).toContain('quick-open-dialog__item--selected');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });
});
