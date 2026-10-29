import { product } from '@workspace/core/product';
import { mount } from '@vue/test-utils';
import { ElPopover } from 'element-plus';
import { describe, expect, it } from 'vitest';
import AgentSidebar from '../AgentSidebar.vue';
import type { Agent, Team } from '@workspace/core/contracts';

import {
  agents,
  clickPortaledMenuItem,
  pointerEvent,
  portaledMenuItems,
  teams,
} from './agent-sidebar-test-harness';

describe('AgentSidebar interactions', () => {
  it('emits fork for an idle Codex agent with a conversation', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [{ ...agents[0], backendSession: { kind: 'codex', threadId: 'thread-dina' } }, agents[1]],
        activeAgentId: 'agent-dina',
        forkableAgentIds: ['agent-dina'],
        teamName: `${product.name}`,
      },
      global: { components: { ElPopover } },
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu');
    await clickPortaledMenuItem('Fork Agent');

    expect(wrapper.emitted('fork-agent')).toStrictEqual([['agent-dina']]);
  });

  it('emits move targets from the context menu submenu', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: agents.map((agent) => ({ ...agent, teamId: 'team-app' })),
        activeAgentId: 'agent-dina',
        teams,
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });
    await clickPortaledMenuItem('Skwad');

    expect(wrapper.emitted('move-agent-to-team')).toStrictEqual([[{
      agentId: 'agent-dina',
      teamId: 'team-skwad',
    }]]);
  });

  it('offers every other team as a move target for a local agent', async () => {
    const remoteTeam: Team = {
      id: 'team-remote',
      name: 'Remote Core',
      agentIds: [],
    };
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: agents.map((agent) => ({ ...agent, teamId: 'team-app' })),
        activeAgentId: 'agent-dina',
        teams: [...teams, remoteTeam],
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });

    expect(portaledMenuItems().some((item) => item.textContent?.trim() === 'Skwad')).toBe(true);
    expect(portaledMenuItems().some((item) => item.textContent?.trim() === 'Remote Core')).toBe(true);
  });

  it('hides all move targets for remote agents', async () => {
    const remoteAgent: Agent = {
      ...agents[0],
      id: 'agent-remote',
      teamId: 'team-remote',
      remoteConnectionId: 'connection-devbox',
    };
    const wrapper = mount(AgentSidebar, {
      props: {
        agents: [remoteAgent],
        activeAgentId: 'agent-remote',
        teams: [
          ...teams,
          {
            id: 'team-remote',
            name: 'Remote Core',
            agentIds: ['agent-remote'],
          },
        ],
        teamName: 'Remote Core',
      },
      global: {
        components: { ElPopover },
      },
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });

    expect(portaledMenuItems().some((item) => item.textContent?.trim() === 'Skwad')).toBe(false);
    expect(portaledMenuItems().some((item) => item.textContent?.trim() === `${product.name}`)).toBe(false);
  });

  it('closes the context menu when the menu emits close', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    await wrapper.findAll('.agent-sidebar__agent')[0].trigger('contextmenu', {
      clientX: 120,
      clientY: 80,
    });

    expect(document.body.querySelector('.agent-context-menu')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(document.body.querySelector('.agent-context-menu')).toBeNull();
  });

  it('emits collapse requests from the team header icon', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    await wrapper.get('[aria-label="Hide agent sidebar"]').trigger('click');

    expect(wrapper.emitted('collapse-sidebar')).toStrictEqual([[]]);
  });

  it('renders a clamped sidebar width contract for the shell', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
        width: 180,
        minWidth: 220,
        maxWidth: 420,
      },
      global: {
        components: { ElPopover },
      },
    });

    expect(wrapper.attributes('style')).toContain('--agent-sidebar-width: 220px');
    expect(wrapper.attributes('style')).toContain('--agent-sidebar-min-width: 220px');
    expect(wrapper.attributes('style')).toContain('--agent-sidebar-max-width: 420px');
  });

  it('keeps the expanded sidebar readable when given an undersized width', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
        width: 40,
      },
      global: {
        components: { ElPopover },
      },
    });

    expect(wrapper.attributes('style')).toContain('--agent-sidebar-width: 200px');
    const handle = wrapper.get('[aria-label="Resize agent sidebar"]');
    expect(handle.attributes('aria-valuemin')).toBe('200');
    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('resize-sidebar')).toStrictEqual([[200]]);
  });

  it('emits clamped resize widths from the right border drag handle', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
        width: 260,
        minWidth: 220,
        maxWidth: 420,
      },
      global: {
        components: { ElPopover },
      },
    });

    const handle = wrapper.get('[aria-label="Resize agent sidebar"]');

    handle.element.dispatchEvent(pointerEvent('pointerdown', 260));
    handle.element.dispatchEvent(pointerEvent('pointermove', 500));
    handle.element.dispatchEvent(pointerEvent('pointerup', 500));

    expect(wrapper.emitted('resize-sidebar')).toStrictEqual([[420]]);
  });

  it('supports keyboard resizing from the right border handle', async () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
        width: 260,
      },
      global: {
        components: { ElPopover },
      },
    });

    const handle = wrapper.get('[aria-label="Resize agent sidebar"]');

    await handle.trigger('keydown', { key: 'ArrowLeft' });
    await handle.trigger('keydown', { key: 'ArrowRight' });

    expect(wrapper.emitted('resize-sidebar')).toStrictEqual([[244], [276]]);
  });

  it('does not render conversation history in the sidebar footer', () => {
    const wrapper = mount(AgentSidebar, {
      props: {
        agents,
        activeAgentId: 'agent-dina',
        teamName: `${product.name}`,
      },
      global: {
        components: { ElPopover },
      },
    });

    expect(wrapper.find('.agent-sidebar__conversations').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('CONVERSATIONS');
  });
});
