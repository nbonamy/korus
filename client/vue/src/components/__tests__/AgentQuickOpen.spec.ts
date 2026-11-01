import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Agent, Team } from '@workspace/core/contracts';
import AgentQuickOpen from '../AgentQuickOpen.vue';

const teams: Team[] = [
  { id: 'team-current', name: 'Current team', agentIds: ['agent-current', 'agent-current-unread'] },
  { id: 'team-other', name: 'Other team', agentIds: ['agent-other', 'agent-other-unread'] },
];
const agents: Agent[] = [
  agent('agent-other', 'Other read', 'team-other'),
  agent('agent-current', 'Current read', 'team-current'),
  agent('agent-other-unread', 'Other unread', 'team-other'),
  agent('agent-current-unread', 'Current unread', 'team-current'),
];

describe('AgentQuickOpen', () => {
  it('puts unread agents first and orders each group by recent activity', () => {
    const wrapper = mount(AgentQuickOpen, {
      props: {
        agents,
        teams,
        unreadAgentIds: ['agent-other-unread', 'agent-current-unread'],
      },
    });

    expect(wrapper.findAll('.agent-quick-open__copy strong').map((row) => row.text())).toStrictEqual([
      'Other unread',
      'Current unread',
      'Current read',
      'Other read',
    ]);
    expect(wrapper.find('.agent-quick-open__repository').text()).toBe('@ repo-agent-other-unread');
    expect(wrapper.find('.agent-quick-open__team').text()).toBe('Other team');
  });

  it('searches team names and emits the selected agent and team', async () => {
    const wrapper = mount(AgentQuickOpen, {
      props: {
        agents,
        teams,
        unreadAgentIds: [],
      },
    });

    const input = wrapper.get('input');
    await input.setValue('other team');
    expect(wrapper.findAll('.agent-quick-open__copy strong').map((row) => row.text())).toStrictEqual([
      'Other unread',
      'Other read',
    ]);
    await input.trigger('keydown.enter');

    expect(wrapper.emitted('select')).toStrictEqual([[{
      agentId: 'agent-other-unread',
      teamId: 'team-other',
    }]]);
  });

  it('does not match text that only appears in an absolute workspace path', async () => {
    const pathAgents = agents.map((candidate) => ({
      ...candidate,
      folder: `/Users/nbonamy/src/${candidate.id}`,
      workspace: candidate.workspace?.kind === 'git'
        ? {
            ...candidate.workspace,
            folder: `/Users/nbonamy/src/${candidate.id}`,
            primaryWorktreeRoot: `/Users/nbonamy/src/${candidate.id}`,
            repositoryRoot: `/Users/nbonamy/src/${candidate.id}`,
          }
        : candidate.workspace,
    }));
    const wrapper = mount(AgentQuickOpen, {
      props: {
        agents: pathAgents,
        teams,
        unreadAgentIds: [],
      },
    });

    await wrapper.get('input').setValue('use');

    expect(wrapper.findAll('.quick-open-dialog__item')).toHaveLength(0);
    expect(wrapper.text()).toContain('No matching agents');
  });

  it('shows repository icons and uses branch or worktree glyphs when no icon is set', () => {
    const main = agent('main', 'Main', 'team-current');
    const custom = agent('custom', 'Custom', 'team-current');
    const worktree = agent('worktree', 'Worktree', 'team-current');
    if (custom.workspace?.kind !== 'git' || worktree.workspace?.kind !== 'git') throw new Error('Expected Git workspaces');
    worktree.workspace = { ...worktree.workspace, isLinkedWorktree: true };
    const quickChat = { ...agent('chat', 'Chat', 'team-current'), sessionKind: 'quickChat' as const, workspace: undefined };
    const wrapper = mount(AgentQuickOpen, {
      props: {
        agents: [main, custom, worktree, quickChat],
        teams,
        unreadAgentIds: [],
        repositoryIcons: { [custom.workspace.primaryWorktreeRoot]: '🐝' },
      },
    });

    const rows = wrapper.findAll('.quick-open-dialog__item');
    const row = (name: string) => rows.find((candidate) => candidate.text().includes(name))!;
    expect(row('Main').find('.agent-quick-open-icon__session--main').exists()).toBe(true);
    expect(row('Custom').find('.agent-avatar').text()).toContain('🐝');
    expect(row('Custom').find('.agent-quick-open-icon__session').exists()).toBe(false);
    expect(row('Worktree').find('.agent-quick-open-icon__session--worktree').exists()).toBe(true);
    expect(row('Chat').find('[data-icon="message"]').exists()).toBe(true);
    expect(row('Chat').find('.agent-avatar').exists()).toBe(false);
  });
});

function agent(id: string, name: string, teamId: string): Agent {
  const activityById: Record<string, string> = {
    'agent-other': '2026-09-15T00:00:01.000Z',
    'agent-current': '2026-09-15T00:00:02.000Z',
    'agent-current-unread': '2026-09-15T00:00:03.000Z',
    'agent-other-unread': '2026-09-15T00:00:04.000Z',
  };
  return {
    id,
    teamId,
    name,
    folder: `/workspace/${id}`,
    workspace: {
      kind: 'git',
      folder: `/workspace/${id}`,
      repositoryName: `repo-${id}`,
      repositoryRoot: `/workspace/${id}`,
      branch: 'main',
      isLinkedWorktree: false,
      primaryWorktreeRoot: `/workspace/${id}`,
      updatedAt: '2026-09-15T00:00:00.000Z',
    },
    backend: 'codex',
    status: { type: 'idle' },
    createdAt: '2026-09-15T00:00:00.000Z',
    lastActivityAt: activityById[id]!,
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}
