import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { windowState } from '../../window-state';
import { mountShell } from './app-shell-test-harness';

afterEach(() => {
  windowState.scope.value = 'workspace';
  windowState.teamId.value = null;
  windowState.agentId.value = null;
  windowState.branch.value = null;
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

  describe('a feature window', () => {
    function featureSnapshot() {
      const snapshot = createInitialSnapshot();
      const teamId = snapshot.teams[0]!.id;
      snapshot.agents.forEach((agent, index) => {
        agent.teamId = teamId;
        agent.workspace = { kind: 'git', branch: index === 0 ? 'feat1' : 'feat2' } as never;
      });
      windowState.scope.value = 'feature';
      windowState.teamId.value = teamId;
      windowState.branch.value = 'feat1';
      return snapshot;
    }

    it('shows only the agents of its branch, with nothing that creates anything', () => {
      const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot: featureSnapshot() });
      expect(wrapper.find('.team-rail').exists()).toBe(false);
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);
      expect(wrapper.find('.agent-sidebar__start-work').exists()).toBe(false);
      expect(wrapper.text()).not.toMatch(/Quick chat|New mission|Add project/);
    });

    it('shows an agent added to the branch afterwards, and not one added to another', async () => {
      const snapshot = featureSnapshot();
      const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true, snapshot });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);

      const added = (id: string, branch: string) => ({ ...structuredClone(snapshot.agents[0]!), id, name: id, workspace: { kind: 'git', branch } as never });
      const next = structuredClone(snapshot);
      next.agents.push(added('agent-other', 'feat2'));
      next.teams[0]!.agentIds.push('agent-other');
      await wrapper.setProps({ snapshot: next });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(1);

      const withNew = structuredClone(next);
      withNew.agents.push(added('agent-new', 'feat1'));
      withNew.teams[0]!.agentIds.push('agent-new');
      await wrapper.setProps({ snapshot: withNew });
      expect(wrapper.findAll('.agent-sidebar__agent')).toHaveLength(2);
    });
  });

  it('has no navigation at all in a window for one agent', () => {
    windowState.scope.value = 'agent';
    const wrapper = mountShell({ realAgentSidebar: true, stubAgentWorkspace: true });
    expect(wrapper.find('.app-shell__nav').exists()).toBe(false);
    expect(wrapper.classes()).toContain('app-shell--chromeless');
  });
});
