import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox } from 'element-plus';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TeamRail from '../TeamRail.vue';
import type { AccountRateLimits, AgentBackend, RemoteConnection, Team } from '@workspace/core/contracts';
import { setElectronTestClient } from '../../test/client';

let mountedWrappers: ReturnType<typeof mount>[] = [];

afterEach(() => {
  for (const wrapper of mountedWrappers) {
    wrapper.unmount();
  }
  mountedWrappers = [];
  vi.restoreAllMocks();
});

const teams: Team[] = [
  {
    id: 'team-sk',
    name: 'Skwad',
    avatar: 'SK',
    color: '#46A857',
    agentIds: ['agent-dina'],
  },
  {
    id: 'team-app',
    name: `${product.name}`,
    color: '#1B4FB2',
    agentIds: [],
  },
];


describe('TeamRail', () => {
  it('matches the selection ring to the selected team color', async () => {
    const wrapper = mountRail({ teams, activeTeamId: 'team-app' });
    expect(getComputedStyle(wrapper.get(`[aria-label="${product.name}"]`).element).outlineColor)
      .toBe('rgb(27, 79, 178)');

    await wrapper.setProps({ activeTeamId: 'team-sk' });
    expect(getComputedStyle(wrapper.get('[aria-label="Skwad"]').element).outlineColor)
      .toBe('rgb(70, 168, 87)');
    expect(getComputedStyle(wrapper.get(`[aria-label="${product.name}"]`).element).outline)
      .toBe('');
  });

  it('renders teams and marks the active team', () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-app',
    });

    expect(wrapper.get('[aria-label="Cockpit"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Backlog"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Skwad"]').text()).toBe('SK');
    const brandedTeam = wrapper.get(`[aria-label="${product.name}"]`);
    expect(brandedTeam.text()).toBe('');
    expect(brandedTeam.get('svg').attributes('fill')).toBe('currentColor');
    expect(brandedTeam.get('svg').attributes('aria-hidden')).toBe('true');
    const markStyle = getComputedStyle(brandedTeam.get('svg').element);
    expect(markStyle.width).toBe('var(--icon-md)');
    expect(markStyle.height).toBe('var(--icon-md)');
    expect(wrapper.get(`[aria-label="${product.name}"]`).attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Skwad"]').attributes('aria-pressed')).toBe('false');
    expect((wrapper.get('[aria-label="Skwad"]').element as HTMLButtonElement).style.backgroundColor).toBe('rgb(70, 168, 87)');
    expect(wrapper.find('.team-rail__window-controls').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Create team"]').exists()).toBe(true);
    expect(wrapper.get('[aria-label="Automations"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Settings menu"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('.team-rail__header').exists()).toBe(true);
    expect(wrapper.get('.team-rail__body').find('[aria-label="Cockpit"]').exists()).toBe(true);
    expect(wrapper.get('.team-rail__body').findAll('button').slice(0, 2).map((button) => button.attributes('aria-label')))
      .toStrictEqual(['Backlog', 'Cockpit']);
  });

  it('marks when the adjacent agent sidebar is expanded', () => {
    const expanded = mountRail({
      teams,
      activeTeamId: 'team-app',
      agentSidebarExpanded: true,
    });
    const collapsed = mountRail({
      teams,
      activeTeamId: 'team-app',
      agentSidebarExpanded: false,
    });

    expect(expanded.classes()).toContain('team-rail--agent-sidebar-expanded');
    expect(collapsed.classes()).not.toContain('team-rail--agent-sidebar-expanded');
    expect(getComputedStyle(expanded.get('.team-rail__header').element).background).toBe('var(--color-shell-rail)');
    expect(getComputedStyle(collapsed.get('.team-rail__header').element).background).toBe('var(--color-shell-collapsed-header)');
  });

  it('shows a corner indicator on teams containing unread agents', () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-app',
      unreadTeamIds: ['team-sk', 'team-app'],
    });

    const unreadTeam = wrapper.get('[aria-label="Skwad, unread activity"]');
    expect(unreadTeam.classes()).toContain('team-rail__team--unread');
    expect(unreadTeam.get('.team-rail__unread-indicator').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get(`[aria-label="${product.name}"]`).find('.team-rail__unread-indicator').exists()).toBe(false);
  });

  it('reuses the corner dot for working activity with unread taking precedence', () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-app',
      unreadTeamIds: ['team-sk'],
      workingTeamIds: ['team-sk', 'team-app'],
    });

    const workingUnread = wrapper.get('[aria-label="Skwad, agents working, unread activity"]');
    const activeWorking = wrapper.get(`[aria-label="${product.name}, agents working"]`);
    expect(workingUnread.get('.team-rail__unread-indicator').classes())
      .not.toContain('team-rail__unread-indicator--working');
    expect(workingUnread.findAll('.team-rail__unread-indicator')).toHaveLength(1);
    expect(activeWorking.find('.team-rail__unread-indicator').exists()).toBe(false);
    expect(activeWorking.classes()).toContain('team-rail__team--active');

    const workingOnly = mountRail({
      teams,
      activeTeamId: 'team-app',
      workingTeamIds: ['team-sk'],
    }).get('[aria-label="Skwad, agents working"]');
    expect(workingOnly.get('.team-rail__unread-indicator').classes())
      .toContain('team-rail__unread-indicator--working');
  });

  it('falls back to team initials when no avatar is set', () => {
    const wrapper = mountRail({
      teams: [{ ...teams[1], name: 'Research' }],
      activeTeamId: null,
    });

    expect(wrapper.get('[aria-label="Research"]').text()).toBe('RE');
  });

  it('switches between the product mark and the saved avatar when a team is renamed', async () => {
    const team = { ...teams[0], name: product.name };
    const wrapper = mountRail({ teams: [team], activeTeamId: team.id });
    expect(wrapper.get(`[aria-label="${product.name}"]`).find('svg').exists()).toBe(true);
    expect(wrapper.get(`[aria-label="${product.name}"]`).text()).toBe('');
    await wrapper.setProps({ teams: [{ ...team, name: 'Research' }] });
    expect(wrapper.get('[aria-label="Research"]').find('svg').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Research"]').text()).toBe('SK');
  });

  it('falls back to the default team color when none is set', () => {
    const wrapper = mountRail({
      teams: [{
        id: 'team-plain',
        name: 'Plain Team',
        agentIds: [],
      }],
      activeTeamId: null,
    });

    expect(wrapper.get('[aria-label="Plain Team"]').text()).toBe('PT');
    expect((wrapper.get('[aria-label="Plain Team"]').element as HTMLButtonElement).style.backgroundColor).toBe('rgb(27, 79, 178)');
  });

  it('emits team selection and new team intents', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('click');
    await wrapper.get('[aria-label="Create team"]').trigger('click');

    expect(wrapper.emitted('select-team')).toStrictEqual([['team-app']]);
    expect(wrapper.emitted('new-team')).toStrictEqual([[]]);
  });

  it('emits cockpit selection and marks it active', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      cockpitActive: true,
    });

    await wrapper.get('[aria-label="Cockpit"]').trigger('click');

    expect(wrapper.get('[aria-label="Cockpit"]').find('svg.tabler-icon-ai-agents').exists()).toBe(true);
    expect(wrapper.get('[aria-label="Cockpit"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Cockpit"]').classes()).toContain('team-rail__cockpit--active');
    expect(wrapper.get('[aria-label="Skwad"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Skwad"]').classes()).not.toContain('team-rail__team--active');
    expect(wrapper.emitted('select-cockpit')).toStrictEqual([[]]);
  });

  it('emits backlog selection and marks it active', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      backlogActive: true,
    });

    await wrapper.get('[aria-label="Backlog"]').trigger('click');

    expect(wrapper.get('[aria-label="Backlog"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Backlog"]').classes()).toContain('team-rail__backlog--active');
    expect(wrapper.get('[aria-label="Backlog"]').findComponent({ name: 'BacklogIcon' }).exists()).toBe(true);
    expect(wrapper.get('[aria-label="Skwad"]').classes()).not.toContain('team-rail__team--active');
    expect(wrapper.emitted('select-backlog')).toStrictEqual([[]]);
  });

  it('keeps navigation borderless until selected and matches all active navigation to the add-team surface', async () => {
    const wrapper = mountRail({ teams, activeTeamId: 'team-sk' });
    const cockpit = wrapper.get('[aria-label="Cockpit"]');
    const add = wrapper.get('[aria-label="Create team"]');
    expect(cockpit.get('svg').attributes('stroke')).toBe('currentColor');
    expect(wrapper.find('[role="separator"]').exists()).toBe(false);
    const navigation = [
      ['backlogActive', 'Backlog'],
      ['automationsActive', 'Automations'], ['settingsActive', 'Settings menu'],
    ] as const;
    for (const [, label] of navigation) {
      const style = getComputedStyle(wrapper.get(`[aria-label="${label}"]`).element);
      expect(style.borderTopWidth).toBe('0px');
      expect(style.opacity).toBe('0.6');
      expect(style.padding).toBe('0px');
    }
    for (const [mode, label] of navigation) {
      await wrapper.setProps({ cockpitActive: false, backlogActive: false, automationsActive: false, settingsActive: false, [mode]: true });
      const active = wrapper.get(`[aria-label="${label}"]`);
      const style = getComputedStyle(active.element);
      expect(style.background).toBe(getComputedStyle(add.element).background);
      expect(style.borderRadius).toBe(getComputedStyle(add.element).borderRadius);
      expect(style.opacity).toBe('1');
    }
  });

  it('emits automations selection and marks it active', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      automationsActive: true,
    });

    await wrapper.get('[aria-label="Automations"]').trigger('click');

    expect(wrapper.get('[aria-label="Automations"] svg').classes()).toContain('tabler-icon-clock-hour-8');
    expect(wrapper.get('[aria-label="Automations"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Automations"]').classes()).toContain('team-rail__automations--active');
    expect(wrapper.get('[aria-label="Skwad"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Skwad"]').classes()).not.toContain('team-rail__team--active');
    expect(wrapper.emitted('select-automations')).toStrictEqual([[]]);
  });

  it('marks settings active without keeping a team focused', () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      settingsActive: true,
    });

    expect(wrapper.get('[aria-label="Settings menu"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Settings menu"]').classes()).toContain('settings-menu__trigger--active');
    expect(wrapper.get('[aria-label="Skwad"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Skwad"]').classes()).not.toContain('team-rail__team--active');
  });

  it('toggles global speech mute above automations when acknowledgments are enabled', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      spokenAnnouncementsEnabled: true,
      spokenAnnouncementsMuted: false,
    });

    const mute = wrapper.get('[aria-label="Mute spoken acknowledgments (⇧⌘M)"]');
    const automations = wrapper.get('[aria-label="Automations"]');
    expect(mute.element.compareDocumentPosition(automations.element) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
    expect(mute.attributes('aria-pressed')).toBe('false');
    const unmutedStyle = getComputedStyle(mute.element);
    expect(unmutedStyle.opacity).toBe('0.6');
    expect(unmutedStyle.borderTopWidth).toBe('0px');
    await wrapper.setProps({ spokenAnnouncementsMuted: true });
    expect(wrapper.get('[aria-label="Unmute spoken acknowledgments (⇧⌘M)"]').attributes('aria-pressed')).toBe('true');
    const mutedStyle = getComputedStyle(mute.element);
    expect(mutedStyle.opacity).toBe(unmutedStyle.opacity);
    expect(mutedStyle.color).toBe(unmutedStyle.color);
    expect(mutedStyle.background).toBe(unmutedStyle.background);
    expect(mutedStyle.borderTopWidth).toBe('0px');
    await mute.trigger('click');
    expect(wrapper.emitted('toggle-speech-mute')).toStrictEqual([[]]);
  });

  it('hides global speech mute when spoken acknowledgments are disabled', () => {
    const wrapper = mountRail({ teams, activeTeamId: 'team-sk' });
    expect(wrapper.find('.team-rail__speech-mute').exists()).toBe(false);
  });

  it('emits team reorder drops and marks the drop location', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });
    const buttons = wrapper.findAll('.team-rail__team');
    const skwadButton = buttons[0];
    const appButton = buttons[1];
    expect(skwadButton.attributes('draggable')).toBe('true');
    mockRect(appButton.element, { top: 100, height: 44 });

    skwadButton.element.dispatchEvent(dragEvent('dragstart', 0));
    appButton.element.dispatchEvent(dragEvent('dragover', 132));
    await nextTick();

    expect(appButton.classes()).toContain('list-reorder-drag--drop-after');

    appButton.element.dispatchEvent(dragEvent('drop', 132));
    await nextTick();

    expect(wrapper.emitted('reorder-teams')).toStrictEqual([[
      {
        teamId: 'team-sk',
        beforeTeamId: null,
      },
    ]]);
  });

  it('shows rate limits and emits settings menu actions', async () => {
    setElectronTestClient({});
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
      enabledBackends: ['codex'],
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 32,
          windowDurationMins: 300,
          resetsAt: 1_780_756_682,
        },
        secondary: {
          usedPercent: 50,
          windowDurationMins: 10_080,
          resetsAt: 1_781_140_878,
        },
        credits: null,
        individualLimit: null,
        planType: 'pro',
        rateLimitReachedType: null,
      },
    });

    expect(wrapper.find('[aria-label="5h"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('68%');
    expect(wrapper.find('[aria-label="Weekly"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('50%');
    await wrapper.findAll('button').find((button) => {
      const label = button.find('.app-menu__label');
      return label.exists() && label.text() === 'Settings';
    })?.trigger('click');
    await wrapper.get('[aria-label$="menu"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'What’s New')?.trigger('click');
    await wrapper.get('[aria-label$="menu"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'Quit')?.trigger('click');

    expect(wrapper.emitted('open-settings')).toStrictEqual([[]]);
    expect(wrapper.emitted('open-whats-new')).toStrictEqual([[]]);
    expect(wrapper.emitted('quit')).toStrictEqual([[]]);
  });

  it('opens the team menu and emits edit team intents', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('contextmenu', {
      clientX: 42,
      clientY: 64,
    });
    expect(wrapper.get('.team-context-menu').attributes('style')).toContain('left: 42px');
    expect(wrapper.find('[aria-label="Team actions"]').exists()).toBe(true);
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Edit Team')?.trigger('click');

    expect(wrapper.emitted('edit-team')).toStrictEqual([['team-app']]);
  });

  it('confirms before closing the context-clicked team', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockImplementation(async () => {
      expect(wrapper.find('.team-context-menu').exists()).toBe(false);
      return 'confirm' as never;
    });

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close Team')?.trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(
      `Agents, missions and quick chats will be removed from ${product.name}. Mission worktrees will not be deleted.`,
      `Close ${product.name}?`,
      {
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Close Team',
        type: 'warning',
      },
    );
    expect(wrapper.emitted('close-team')).toStrictEqual([['team-app']]);
  });

  it('keeps floating UI open for inside clicks and closes it for escape or outside clicks', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('contextmenu');
    await wrapper.get('.team-context-menu').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(wrapper.find('.team-context-menu').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('.team-context-menu').exists()).toBe(false);

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('contextmenu');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(wrapper.find('.team-context-menu').exists()).toBe(false);
  });

  it('keeps the team when close confirmation is canceled', async () => {
    const wrapper = mountRail({
      teams,
      activeTeamId: 'team-sk',
    });
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'));

    await wrapper.get(`[aria-label="${product.name}"]`).trigger('contextmenu');
    await wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close Team')?.trigger('click');

    expect(wrapper.emitted('close-team')).toBeUndefined();
  });

  it('disables closing when only one team exists', async () => {
    const wrapper = mountRail({
      teams: [teams[0]],
      activeTeamId: 'team-sk',
    });

    await wrapper.get('[aria-label="Skwad"]').trigger('contextmenu');

    const closeItem = wrapper.findAll('[role="menuitem"]').find((item) => item.text() === 'Close Team');
    expect(closeItem?.attributes()).toHaveProperty('disabled');
  });
});

function mountRail(props: {
  teams: Team[];
  activeTeamId: string | null;
  backlogActive?: boolean;
  cockpitActive?: boolean;
  automationsActive?: boolean;
  rateLimits?: AccountRateLimits;
  enabledBackends?: AgentBackend[];
  settingsActive?: boolean;
  agentSidebarExpanded?: boolean;
  spokenAnnouncementsEnabled?: boolean;
  spokenAnnouncementsMuted?: boolean;
  unreadTeamIds?: string[];
  workingTeamIds?: string[];
}) {
  const wrapper = mount(TeamRail, {
    attachTo: document.body,
    props,
    global: {
      stubs: {
        ElPopover: {
          template: '<div><slot name="reference" /><slot /></div>',
        },
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function dragEvent(type: string, clientY: number): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  const dataTransfer = {
    dropEffect: '',
    effectAllowed: '',
    setData: vi.fn(),
  };

  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function mockRect(element: Element, rect: { top: number; height: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    bottom: rect.top + rect.height,
    height: rect.height,
    left: 0,
    right: 44,
    width: 44,
    x: 0,
    y: rect.top,
    toJSON: () => undefined,
  });
}
