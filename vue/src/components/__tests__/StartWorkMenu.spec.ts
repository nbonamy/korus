import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import StartWorkMenu from '../StartWorkMenu.vue';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StartWorkMenu', () => {
  it('opens invitation joining from the project menu', async () => {
    const wrapper = mount(StartWorkMenu, { attachTo: document.body });
    await wrapper.get('[aria-label="Add project"]').trigger('click');
    const invite = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes('Join with invite'));
    expect(invite).toBeDefined();
    invite!.click(); await wrapper.vm.$nextTick();
    expect(wrapper.emitted('select')).toStrictEqual([['invite']]);
  });
  it('offers project acquisition from a prominent new-session trigger', async () => {
    const wrapper = mount(StartWorkMenu, {
      attachTo: document.body,
    });

    expect(wrapper.getComponent({ name: 'ElPopover' }).props('width')).toBe(240);
    expect(wrapper.get('[aria-label="Add project"]').text()).toBe('Add project');
    expect(wrapper.get('[aria-label="Add project"]').find('[data-icon="folders"]').exists()).toBe(true);
    await wrapper.get('[aria-label="Add project"]').trigger('click');

    expect(document.body.textContent).toContain('Add project from');
    expect(document.body.textContent).toContain('New project…');
    expect(document.body.textContent).toContain('Existing folder or repository…');
    expect(document.body.textContent).toContain('GitHub repository…');
    expect(document.body.textContent).toContain('Repository URL…');
    expect(wrapper.findComponent({ name: 'GitHubIcon' }).exists()).toBe(true);

    const github = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.includes('GitHub repository'));
    github!.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('select')).toStrictEqual([['github']]);
  });

});
