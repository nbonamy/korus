import { product } from '@workspace/core/product';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TeamContextMenu from '../TeamContextMenu.vue';
import type { Team } from '@workspace/core/contracts';
import { setElectronTestClient } from '../../test/client';

const team: Team = {
  id: 'team-app',
  name: `${product.name}`,
  avatar: 'CC',
  color: '#1B4FB2',
  agentIds: ['agent-dina'],
};

let mountedWrappers: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (const wrapper of mountedWrappers) {
    wrapper.unmount();
  }
  mountedWrappers = [];
  vi.restoreAllMocks();
});

describe('TeamContextMenu', () => {
  it('renders team actions with shared app menu styling at the requested position', () => {
    const wrapper = mountMenu();

    expect(wrapper.find('.app-menu').exists()).toBe(true);
    expect(wrapper.attributes('style')).toContain('left: 120px');
    expect(wrapper.attributes('style')).toContain('top: 80px');
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toStrictEqual([
      'Edit',
      'Close',
    ]);
  });

  it('offers to open the team in a new window when the host can', async () => {
    setElectronTestClient({ openWindow: vi.fn() });
    try {
      const wrapper = mountMenu();
      expect(wrapper.findAll('[role="menuitem"], [role="separator"]').map(item => item.attributes('role') === 'separator' ? 'divider' : item.text()))
        .toStrictEqual(['Open in New Window', 'divider', 'Edit', 'Close']);
      await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Open in New Window')?.trigger('click');
      expect(wrapper.emitted('open-team-window')).toStrictEqual([['team-app']]);
    } finally {
      setElectronTestClient(undefined);
    }
  });

  it('emits edit requests for the selected team', async () => {
    const wrapper = mountMenu();

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Edit')?.trigger('click');

    expect(wrapper.emitted('edit-team')).toStrictEqual([['team-app']]);
  });

  it('requests close for the selected team', async () => {
    const wrapper = mountMenu();

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close')?.trigger('click');

    expect(wrapper.emitted('request-close-team')).toStrictEqual([['team-app']]);
  });

  it('disables close when the rail has only one team', async () => {
    const wrapper = mountMenu({ canClose: false });

    const closeItem = wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close');
    expect(closeItem?.attributes()).toHaveProperty('disabled');

    await closeItem?.trigger('click');
    expect(wrapper.emitted('request-close-team')).toBeUndefined();
  });

  it('requests close when the user clicks elsewhere or presses escape', () => {
    const wrapper = mountMenu();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(wrapper.emitted('close')).toStrictEqual([[], []]);
  });
});

function mountMenu(overrides: Partial<{ canClose: boolean; team: Team }> = {}) {
  const wrapper = mount(TeamContextMenu, {
    props: {
      canClose: overrides.canClose ?? true,
      team: overrides.team ?? team,
      x: 120,
      y: 80,
    },
    attachTo: document.body,
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}
