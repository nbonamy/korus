import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { windowState } from '../../window-state';
import { mountShell } from './app-shell-test-harness';

afterEach(() => {
  windowState.scope.value = 'workspace';
  windowState.teamId.value = null;
  windowState.agentId.value = null;
  windowState.agentIds.value = [];
  document.body.innerHTML = '';
});

describe('AppShell in a window that shows less than the workspace', () => {
  it('shows everything in a workspace window', () => {
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.team-rail').exists()).toBe(true);
    expect(wrapper.text()).toMatch(/Quick chat/);
  });

  it('drops the rail in a team window and keeps the team’s sidebar', () => {
    windowState.scope.value = 'team';
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.team-rail').exists()).toBe(false);
    expect(wrapper.find('.agent-sidebar').exists()).toBe(true);
    expect(wrapper.classes()).toContain('app-shell--no-rail');
  });

  it('shows only the agents of a feature, with nothing that creates anything', () => {
    const snapshot = createInitialSnapshot();
    windowState.scope.value = 'feature';
    windowState.agentIds.value = [snapshot.agents[0]!.id];
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot });
    expect(wrapper.find('.team-rail').exists()).toBe(false);
    expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);
    expect(wrapper.find('.agent-sidebar__start-work').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Quick chat|New mission|Add project/);
  });

  it('has no navigation at all in a window for one agent', () => {
    windowState.scope.value = 'agent';
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.app-shell__nav').exists()).toBe(false);
    expect(wrapper.classes()).toContain('app-shell--chromeless');
  });
});
