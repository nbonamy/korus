import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentContextMenu from '../AgentContextMenu.vue';
import { ViewportShortIcon } from '../../shared/icons/app-icons';
import type { Team } from '@workspace/core/contracts';

let mountedWrappers: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (const wrapper of mountedWrappers) {
    wrapper.unmount();
  }
  mountedWrappers = [];
  vi.restoreAllMocks();
});

describe('AgentContextMenu', () => {
  it('offers only Leave for a shared Quick Chat', async () => {
    const wrapper = mountMenu({ shared: true });
    expect(wrapper.findAll('[role="menuitem"]').map(item => item.text())).toStrictEqual(['Leave']);
    await wrapper.get('[role="menuitem"]').trigger('click');
    expect(wrapper.emitted('action')).toStrictEqual([['close-agent']]);
  });
  it('renders grouped agent actions at the requested position', () => {
    const wrapper = mountMenu();

    expect(wrapper.get('.agent-context-menu').attributes('style')).toContain('left: 120px');
    expect(wrapper.get('.agent-context-menu').attributes('style')).toContain('top: 80px');
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text())).toStrictEqual([
      'Rename agent',
      'Duplicate Agent',
      'Fork Agent',
      'Hand off…',
      'Move to Other Team',
      'Compact Session⇧⌘K',
      'Resume Session',
      'Restart Agent',
      'Close Agent',
    ]);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(3);
  });

  it('portals above shell clipping and shifts upward when opened near the viewport bottom', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 1_020,
      height: 280,
      left: 120,
      right: 340,
      top: 740,
      width: 220,
      x: 120,
      y: 740,
      toJSON: () => undefined,
    });
    const wrapper = mountMenu({ x: 120, y: 740 }, false);
    await flushPromises();
    await wrapper.vm.$nextTick();

    const menu = document.body.querySelector<HTMLElement>('.agent-context-menu');
    expect(menu).not.toBeNull();
    expect(menu?.style.left).toBe('120px');
    expect(menu?.style.top).toBe('480px');
  });

  it('emits the selected action', async () => {
    const wrapper = mountMenu();

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Duplicate Agent')?.trigger('click');

    expect(wrapper.emitted('action')).toStrictEqual([['duplicate-agent']]);
  });

  it('places fork directly after duplicate and disables it when unavailable', () => {
    const wrapper = mountMenu({ forkDisabled: true });
    const items = wrapper.findAll('[role="menuitem"]');

    expect(items.map((item) => item.text()).slice(0, 4)).toStrictEqual([
      'Rename agent',
      'Duplicate Agent',
      'Fork Agent',
      'Hand off…',
    ]);
    expect(items.find((item) => item.text() === 'Fork Agent')?.attributes()).toHaveProperty('disabled');
  });

  it('emits fork when available', async () => {
    const wrapper = mountMenu();

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Fork Agent')?.trigger('click');

    expect(wrapper.emitted('action')).toStrictEqual([['fork-agent']]);
  });

  it('shows session compression only when supported and emits it as a product action', async () => {
    const wrapper = mountMenu({ compressVisible: true });

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Compress Session')?.trigger('click');

    expect(wrapper.emitted('action')).toStrictEqual([['compress-session']]);
  });

  it('groups compact with compression and emits compact', async () => {
    const wrapper = mountMenu({ compressVisible: true });
    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.map((item) => item.text()).slice(5, 7)).toStrictEqual([
      'Compact Session⇧⌘K',
      'Compress Session',
    ]);
    expect(items[5]?.findComponent(ViewportShortIcon).exists()).toBe(true);
    await items.find((item) => item.text().startsWith('Compact Session'))?.trigger('click');
    expect(wrapper.emitted('action')).toStrictEqual([['compact-session']]);
  });

  it('disables move targets when no other teams are available', () => {
    const wrapper = mountMenu();

    const moveItem = wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Move to Other Team');
    expect(moveItem?.attributes()).toHaveProperty('disabled');
  });

  it('renders a submenu chevron for move targets', () => {
    const wrapper = mountMenu({
      moveTargets: [
        {
          id: 'team-skwad',
          name: 'Skwad',
          avatar: 'SK',
          color: '#46A857',
          agentIds: [],
        },
      ],
    });

    const moveItem = wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Move to Other Team');
    expect(moveItem?.find('.app-menu__chevron').exists()).toBe(true);
  });

  it('allows nested menus to extend beyond the context menu wrapper', () => {
    const wrapper = mountMenu({
      moveTargets: [
        {
          id: 'team-skwad',
          name: 'Skwad',
          avatar: 'SK',
          color: '#46A857',
          agentIds: [],
        },
      ],
    });

    expect(wrapper.get('.agent-context-menu').attributes('style')).toContain('overflow: visible');
  });

  it('emits the selected move target from the submenu', async () => {
    const wrapper = mountMenu({
      moveTargets: [
        {
          id: 'team-skwad',
          name: 'Skwad',
          avatar: 'SK',
          color: '#46A857',
          agentIds: [],
        },
      ],
    });

    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Skwad')?.trigger('click');

    expect(wrapper.emitted('move-agent-to-team')).toStrictEqual([['team-skwad']]);
  });

  it('requests close when the user clicks elsewhere or presses escape', async () => {
    const wrapper = mountMenu();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(wrapper.emitted('close')).toStrictEqual([[], []]);
  });

  it('does not close when the user clicks inside the menu', async () => {
    const wrapper = mountMenu();

    await wrapper.get('.agent-context-menu').trigger('click');

    expect(wrapper.emitted('close')).toBeUndefined();
  });
});

function mountMenu(
  props: { shared?: boolean; compactDisabled?: boolean; compressDisabled?: boolean; compressVisible?: boolean; forkDisabled?: boolean; moveTargets?: Team[]; x?: number; y?: number } = {},
  stubTeleport = true,
) {
  const wrapper = mount(AgentContextMenu, {
    props: {
      x: 120,
      y: 80,
      ...props,
    },
    attachTo: document.body,
    global: {
      stubs: stubTeleport ? { Teleport: true } : {},
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}
