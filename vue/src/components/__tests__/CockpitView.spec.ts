import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import AppMenu from '../../shared/menu/AppMenu.vue';
import CockpitAgentsView from '../CockpitAgentsView.vue';
import CockpitView from '../CockpitView.vue';

describe('CockpitView', () => {
  it('shows all agents grouped by team by default', () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(CockpitView, {
      props: { agents: snapshot.agents, teams: snapshot.teams, viewMode: 'teams' },
    });

    expect(wrapper.get('h1').text()).toBe('Agents');
    expect(wrapper.get('.agent-cockpit__count').text()).toBe(String(snapshot.agents.length));
    expect(wrapper.findComponent(CockpitAgentsView).props('mode')).toBe('teams');
  });

  it('switches the overview from the compact layout menu', async () => {
    const snapshot = createInitialSnapshot();
    const wrapper = mount(CockpitView, {
      props: { agents: snapshot.agents, teams: snapshot.teams, viewMode: 'teams' },
    });

    expect(wrapper.get('.app-menu-chip').text()).toContain('Teams');
    await wrapper.get('.app-menu-chip').trigger('click');
    const menu = wrapper.getComponent(AppMenu);
    expect(menu.props('items')).toEqual([
      expect.objectContaining({ checked: true, id: 'teams', label: 'Teams', type: 'radio', icon: expect.anything() }),
      expect.objectContaining({ checked: false, id: 'recent', label: 'Recent', type: 'radio', icon: expect.anything() }),
    ]);
    menu.vm.$emit('select', 'recent');

    expect(wrapper.emitted('update-view-mode')).toStrictEqual([['recent']]);
    expect(wrapper.findComponent(CockpitAgentsView).props('mode')).toBe('teams');

    await wrapper.setProps({ viewMode: 'recent' });
    expect(wrapper.findComponent(CockpitAgentsView).props('mode')).toBe('recent');
  });

});
