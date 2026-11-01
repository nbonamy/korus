import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WorkspaceHeader from '../WorkspaceHeader.vue';

describe('WorkspaceHeader', () => {
  it('shares header chrome and title styling and adjusts its edge when the sidebar collapses', async () => {
    const wrapper = mount(WorkspaceHeader, {
      attachTo: document.body,
      slots: { default: '<h1 class="workspace-header__title">Project</h1>' },
    });
    const style = () => getComputedStyle(wrapper.element);
    expect(style().minHeight).toBe('var(--workbench-appbar-height)');
    expect(style().boxShadow).toBe('var(--shadow-content-edge)');
    const title = getComputedStyle(wrapper.get('h1').element);
    expect(title.fontWeight).toBe('var(--font-weight-bold)');
    expect(title.textOverflow).toBe('ellipsis');
    await wrapper.setProps({ sidebarCollapsed: true });
    expect(style().boxShadow).toBe('none');
    expect(style().paddingLeft).toBe('var(--space-16)');
  });
});
