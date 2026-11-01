import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import SettingsTextareaField from '../SettingsTextareaField.vue';

it('renders the shared textarea setting and emits edits', async () => {
  const wrapper = mount(SettingsTextareaField, {
    props: {
      modelValue: 'Existing guidance',
      title: 'Commit instructions',
      description: 'Added to commit message generation prompts',
      placeholder: 'Add commit message guidance…',
    },
  });

  expect(wrapper.get('.settings-textarea-field__title').text()).toBe('Commit instructions');
  expect(wrapper.get('.settings-textarea-field__description').text()).toBe('Added to commit message generation prompts');
  expect(wrapper.get('textarea').attributes()).toMatchObject({
    'aria-label': 'Commit instructions',
    placeholder: 'Add commit message guidance…',
    rows: '6',
  });

  await wrapper.get('textarea').setValue('Lowercase conventional commits');
  expect(wrapper.emitted('update:modelValue')).toStrictEqual([['Lowercase conventional commits']]);
});
