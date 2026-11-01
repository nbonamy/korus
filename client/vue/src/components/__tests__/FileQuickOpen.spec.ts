import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FileQuickOpen from '../FileQuickOpen.vue';

describe('FileQuickOpen', () => {
  it('filters and supports arrow, enter, and escape keyboard actions', async () => {
    const wrapper = mount(FileQuickOpen, { props: { files: [
      { name: 'README.md', path: 'README.md' },
      { name: 'main.ts', path: 'src/main.ts' },
    ] } });
    const input = wrapper.get('input');
    await input.setValue('src');
    await input.trigger('keydown.enter');
    expect(wrapper.emitted('select')).toStrictEqual([['src/main.ts']]);
    expect(wrapper.emitted('close')).toHaveLength(1);

    await input.trigger('keydown.escape');
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});
