import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Agent, Team } from '@workspace/core/contracts';
import { i18n } from '@workspace/vue/i18n';
import MobileDrawer from '../MobileDrawer.vue';
import { companionMessages } from '../messages';

i18n.global.mergeLocaleMessage('en', companionMessages);
const agent = (id: string, teamId: string, name: string, status: Agent['status'] = { type: 'idle' }): Agent => ({
  id, teamId, name, folder: null, backend: 'codex', status, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});
const teams: Team[] = [{ id: 't1', name: 'Core', agentIds: ['a1'] }, { id: 't2', name: 'Web', agentIds: ['a2'] }];
const mountDrawer = (props: Partial<InstanceType<typeof MobileDrawer>['$props']> = {}) => mount(MobileDrawer, {
  props: { open: true, teams, agents: [agent('a1', 't1', 'Builder', { type: 'working' })], teamId: 't1', agentId: 'a1', status: 'connected', ...props },
  global: { plugins: [i18n] },
});

const gitAgent = (id: string, branch: string, patch: Partial<Agent> = {}, linked = false): Agent => ({
  ...agent(id, 't1', ''), name: null, ...patch,
  workspace: { kind: 'git', folder: `/h/${id}`, repositoryName: 'codex-app-sdk', repositoryRoot: `/h/${id}`, primaryWorktreeRoot: '/h/root', branch, defaultBranch: 'main', isLinkedWorktree: linked, updatedAt: '' },
});

describe('MobileDrawer', () => {
  it('mirrors the desktop sidebar: repository groups with their icon, branch titles and session kinds', () => {
    const agents = [gitAgent('sdk', 'sdk', {}, true), gitAgent('main', 'main'), gitAgent('sherpa', 'feat/x', { name: 'Sherpa', conversationTitle: 'Sherpa helper lifecycle' }),
      { ...agent('chat', 't1', 'ignored'), name: null, sessionKind: 'quickChat' as const, conversationTitle: 'Plan the trip' }];
    const wrapper = mountDrawer({ agents, agentId: 'main', repositoryIcons: { '/h/root': '⚙️' } });
    const headers = wrapper.findAll('.mobile-drawer__group-header').map((header) => header.text());
    expect(headers[0]).toBe('Chats'); expect(headers).toHaveLength(2);
    expect(wrapper.findAll('.mobile-drawer__group')[0]!.text()).toContain('Plan the trip');
    const rows = wrapper.findAll('.mobile-drawer__group')[1]!.findAll('.mobile-drawer__agent');
    expect(rows.map((row) => [row.text(), row.attributes('data-session-kind')])).toStrictEqual([['sdk', 'worktree'], ['main', 'main'], ['Sherpa helper lifecycle', 'branch']]);
    expect(wrapper.findAll('.mobile-drawer__group')[1]!.get('.mobile-drawer__group-header').text()).toContain('codex-app-sdk');
    expect(wrapper.findAll('.mobile-drawer__group')[1]!.get('.agent-avatar').text()).toBe('⚙️');
    expect(rows[1]!.attributes('aria-current')).toBe('true');
    expect(rows[0]!.find('svg').exists()).toBe(true);
  });

  it('is inert only while closed so an open drawer receives taps', () => {
    expect(mountDrawer({ open: true }).get('aside').attributes('inert')).toBeUndefined();
    expect(mountDrawer({ open: false }).get('aside').attributes('inert')).toBeDefined();
  });

  it('switches teams and agents and exposes the active selection', async () => {
    const wrapper = mountDrawer();
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Core');
    expect(wrapper.get('.mobile-drawer__agent').attributes('aria-current')).toBe('true');
    await wrapper.findAll('[role="tab"]')[1].trigger('click');
    await wrapper.get('.mobile-drawer__agent').trigger('click');
    expect(wrapper.emitted('select-team')).toStrictEqual([['t2']]);
    expect(wrapper.emitted('select-agent')).toStrictEqual([['a1']]);
  });

  it('hides the team switcher for a single team', () => {
    expect(mountDrawer({ teams: [teams[0]] }).find('[role="tablist"]').exists()).toBe(false);
  });

  it('closes on a left swipe and ignores a mostly vertical drag', async () => {
    const wrapper = mountDrawer();
    const swipe = async (from: [number, number], to: [number, number]) => {
      await wrapper.get('aside').trigger('touchstart', { touches: [{ clientX: from[0], clientY: from[1] }] });
      await wrapper.get('aside').trigger('touchend', { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
    };
    await swipe([200, 300], [190, 500]);
    expect(wrapper.emitted('close')).toBeUndefined();
    await swipe([200, 300], [100, 310]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers the connection action that matches the link state', async () => {
    const wrapper = mountDrawer({ status: 'error' });
    expect(wrapper.text()).toContain('Connection failed');
    await wrapper.findAll('button').find((b) => b.text() === 'Reconnect')!.trigger('click');
    await wrapper.findAll('button').find((b) => b.text() === 'Forget laptop')!.trigger('click');
    expect(wrapper.emitted('reconnect')).toHaveLength(1);
    expect(wrapper.emitted('forget')).toHaveLength(1);
    expect(wrapper.findAll('button').some((b) => b.text() === 'Disconnect')).toBe(false);
  });
});
