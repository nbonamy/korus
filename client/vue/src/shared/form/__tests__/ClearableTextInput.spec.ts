import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ClearableTextInput from '../ClearableTextInput.vue';

describe('ClearableTextInput', () => {
  it('forwards native input attributes and events and emits typed values', async () => {
    const keydown = vi.fn();
    const wrapper = mount(ClearableTextInput, {
      props: { modelValue: 'Dina' },
      attrs: { id: 'name', 'aria-label': 'Name', placeholder: 'Optional', maxlength: 40, onKeydown: keydown },
    });
    const input = wrapper.get<HTMLInputElement>('input');
    expect(input.attributes()).toMatchObject({ id: 'name', 'aria-label': 'Name', placeholder: 'Optional', maxlength: '40' });
    await input.setValue('Dina Prime');
    expect(wrapper.emitted('update:modelValue')).toStrictEqual([['Dina Prime']]);
    await input.trigger('keydown', { key: 'Enter' });
    expect(keydown).toHaveBeenCalledOnce();
    await wrapper.setProps({ modelValue: 'Updated elsewhere' });
    expect(input.element.value).toBe('Updated elsewhere');
  });

  it('clears through an accessible button without submitting and returns focus to the input', async () => {
    const submit = vi.fn();
    const wrapper = mount(defineComponent({
      components: { ClearableTextInput },
      setup: () => ({ value: ref('Dina'), submit }),
      template: '<form @submit.prevent="submit"><ClearableTextInput v-model="value" aria-label="Name" clear-label="Clear name" autofocus select-on-mount /></form>',
    }), { attachTo: document.body });
    try {
      await nextTick();
      const input = wrapper.get<HTMLInputElement>('input');
      expect(document.activeElement).toBe(input.element);
      expect([input.element.selectionStart, input.element.selectionEnd]).toStrictEqual([0, 4]);
      const button = wrapper.get<HTMLButtonElement>('button[aria-label="Clear name"]');
      expect(button.get('svg').attributes('aria-hidden')).toBe('true');
      button.element.focus();
      button.element.click();
      await nextTick();
      expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('');
      expect(document.activeElement).toBe(wrapper.get('input').element);
      expect(submit).not.toHaveBeenCalled();
      expect(wrapper.find('button').exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    { modelValue: '', disabled: false, readonly: false },
    { modelValue: 'Dina', disabled: true, readonly: false },
    { modelValue: 'Dina', disabled: false, readonly: true },
  ])('offers no clear action when empty or non-editable: %j', (props) => {
    const wrapper = mount(ClearableTextInput, { props });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get<HTMLInputElement>('input').element.disabled).toBe(props.disabled);
    expect(wrapper.get<HTMLInputElement>('input').element.readOnly).toBe(props.readonly);
  });
});
