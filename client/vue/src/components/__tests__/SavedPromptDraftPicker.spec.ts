import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import SavedPromptDraftPicker from '../SavedPromptDraftPicker.vue';

const drafts = [
  { id: 'first', agentId: 'agent', text: 'Fix the login flow', createdAt: 1 },
  { id: 'second', agentId: 'agent', text: 'Review the release notes', createdAt: 2 },
];

describe('SavedPromptDraftPicker', () => {
  it('explains how to save the first draft without showing that hint for an unmatched search', async () => {
    const wrapper = mount(SavedPromptDraftPicker, { attachTo: document.body, props: { drafts: [] } });
    await nextTick();
    expect(wrapper.find('[role="searchbox"]').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.element);
    expect(wrapper.get('.saved-prompt-draft-picker__empty').text()).toBe('No saved drafts. Use ⇧⌘X to save one.');
    await wrapper.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);

    await wrapper.setProps({ drafts });
    expect(wrapper.find('[role="searchbox"]').exists()).toBe(true);
    await wrapper.get<HTMLInputElement>('input[role="searchbox"]').setValue('nothing matches');
    expect(wrapper.get('.saved-prompt-draft-picker__empty').text()).toBe('No matching drafts.');
  });

  it('searches drafts and offers restore, insert-copy, and deletion from the keyboard or rows', async () => {
    const wrapper = mount(SavedPromptDraftPicker, { attachTo: document.body, props: { drafts } });
    const search = wrapper.get<HTMLInputElement>('input[role="searchbox"]');
    await nextTick();
    expect(document.activeElement).toBe(search.element);
    expect(wrapper.get('.saved-prompt-draft-picker__header').text()).toBe('⇧⏎ to insert a copy');
    expect(wrapper.find('[aria-label="Insert a copy and keep draft"]').exists()).toBe(false);
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2);
    await search.setValue('login');
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1);
    await search.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('select')).toStrictEqual([[{ id: 'first', keep: true }]]);

    await search.setValue('');
    await search.trigger('keydown', { key: 'ArrowDown' });
    await search.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('select')?.[1]).toStrictEqual([{ id: 'first', keep: false }]);
    await wrapper.findAll('[aria-label="Delete saved draft"]')[0]!.trigger('click');
    expect(wrapper.emitted('delete')).toStrictEqual([['second']]);
    await search.trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toStrictEqual([[]]);
  });
});
