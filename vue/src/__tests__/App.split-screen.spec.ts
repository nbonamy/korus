import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { installBackendFixture } from '../test/backend-fixture';
import {
  codexConversationSnapshot,
  codexTextMessage,
} from '../test/codex-conversation-fixtures';

async function chooseLayout(wrapper: ReturnType<typeof mount>, label: string) {
  await wrapper.get('[aria-label="Conversation layout"]').trigger('click');
  await flushPromises();
  const item = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find((item) => item.textContent?.includes(label));
  expect(item).toBeDefined();
  await vi.waitFor(() => expect(new DOMWrapper(item!).isVisible()).toBe(true));
  item!.click();
  await flushPromises();
}

describe('split-screen conversations', () => {
  it('resizes both dividers without replacing composers and restores each team workspace after a restart', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const [first, second] = snapshot.agents;
    const originalTeam = snapshot.teams[0]!;
    const otherAgent = { ...first!, id: 'other-agent', teamId: 'other-team', name: 'Other' };
    snapshot.agents.push(otherAgent);
    snapshot.teams.push({ ...originalTeam, id: 'other-team', name: 'Other team', agentIds: [otherAgent.id] });
    const { api } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async id => ({
      ...snapshot, activeAgentId: id,
      teams: snapshot.teams.map(team => team.agentIds.includes(id) ? { ...team, activeAgentId: id } : team),
    }));
    api.selectTeam.mockImplementation(async id => {
      snapshot.activeTeamId = id;
      snapshot.activeAgentId = snapshot.teams.find(team => team.id === id)!.agentIds[0]!;
      return { ...snapshot };
    });
    const mountApp = async () => {
      const wrapper = mount(App, { attachTo: document.body });
      await flushPromises();
      return wrapper;
    };
    let wrapper = await mountApp();
    const switchTeam = async (name: string) => {
      await wrapper.get(`.team-rail__team[aria-label="${name}"]`).trigger('click');
      await flushPromises();
    };
    await chooseLayout(wrapper, '4-Pane Split');
    const grid = wrapper.get('.agent-split-grid');
    vi.spyOn(grid.element, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
    const composers = wrapper.findAll('[contenteditable="true"]').map(editor => editor.element);
    const drag = async (orientation: string, start: number, end: number) => {
      const handle = wrapper.get(`[role="separator"][aria-label="Resize conversation ${orientation === 'vertical' ? 'columns' : 'rows'}"]`);
      const dispatch = async (type: string, position: number) => {
        handle.element.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
          pointerId: 1, button: 0, clientX: orientation === 'vertical' ? position : 500,
          clientY: orientation === 'horizontal' ? position : 300,
        }));
        await flushPromises();
      };
      await dispatch('pointerdown', start);
      await dispatch('pointermove', end);
      await dispatch('pointerup', end);
      return handle;
    };
    const columns = await drag('vertical', 500, 620);
    const rows = await drag('horizontal', 300, 312);
    expect(columns.attributes('aria-valuenow')).toBe('62');
    expect(rows.attributes('aria-valuenow')).toBe('52');
    expect(wrapper.findAll('[contenteditable="true"]').map(editor => editor.element)).toStrictEqual(composers);
    await columns.trigger('keydown', { key: 'ArrowLeft' });
    expect(columns.attributes('aria-valuenow')).toBe('60');
    await rows.trigger('keydown', { key: 'End' });
    expect(rows.attributes('aria-valuenow')).toBe('53');
    await rows.trigger('dblclick');
    expect(rows.attributes('aria-valuenow')).toBe('50');
    // Persist a deliberate assignment change and an empty focused pane.
    await wrapper.findAll('.agent-split-grid__pane')[0]!.trigger('pointerdown');
    await chooseLayout(wrapper, 'Single Pane');
    const secondRow = wrapper.findAll('.agent-sidebar__agent').find(row => row.text().includes(second!.name!))!;
    await secondRow.trigger('click');
    await flushPromises();
    await chooseLayout(wrapper, '4-Pane Split');
    await wrapper.findAll('.agent-split-grid__pane')[3]!.trigger('pointerdown');
    await switchTeam('Other team');
    await chooseLayout(wrapper, 'Horizontal Split');
    await wrapper.get('[aria-label="Resize conversation rows"]').trigger('keydown', { key: 'ArrowDown' });
    wrapper.unmount();

    wrapper = await mountApp();
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe('2-horizontal');
    expect(wrapper.get('[aria-label="Resize conversation rows"]').attributes('aria-valuenow')).toBe('52');
    await switchTeam(originalTeam.name);
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe('4-quadrant');
    expect(wrapper.findAll('.agent-split-grid__pane').map(pane => pane.attributes('data-agent-id') ?? null))
      .toStrictEqual([second!.id, first!.id, null, null]);
    expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBeUndefined();
    expect(wrapper.get('[aria-label="Resize conversation columns"]').attributes('aria-valuenow')).toBe('60');
    expect(wrapper.get('[aria-label="Resize conversation rows"]').attributes('aria-valuenow')).toBe('50');
    // Mounts the whole app twice; CI runners take 3-5s, so the 5s default leaves no headroom.
  }, 20_000);

  it('preserves the saved split layout while a narrow window shows one conversation', async () => {
    let compact = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', () => ({
      get matches() { return compact; },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    }));
    const resizeWindow = async (value: boolean) => {
      compact = value;
      for (const listener of listeners) listener({ matches: value } as MediaQueryListEvent);
      await flushPromises();
    };
    installBackendFixture(createInitialSnapshot());
    let wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await chooseLayout(wrapper, '4-Pane Split');
    await wrapper.findAll('.agent-split-grid__pane')[3]!.trigger('pointerdown');
    await resizeWindow(true);
    expect(wrapper.find('.agent-split-grid').exists()).toBe(false);
    expect(wrapper.find('[contenteditable="true"]').exists()).toBe(true);
    wrapper.unmount();
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await resizeWindow(false);
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe('4-quadrant');
    expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBeUndefined();
  });

  it('keeps slash review instructions scoped to the sending pane and clears them when its tab closes', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async id => ({
      ...snapshot, activeAgentId: id,
      teams: snapshot.teams.map(team => ({ ...team, activeAgentId: id })),
    }));
    api.startCodeReview.mockResolvedValue(snapshot);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    const panes = wrapper.findAll('.agent-split-grid__pane');
    for (const [index, pane] of panes.entries()) {
      await pane.trigger('pointerdown');
      await flushPromises();
      const editor = pane.get('[contenteditable="true"]');
      editor.element.textContent = `/review Focus for pane ${index}`;
      await editor.trigger('input');
      await pane.get('form').trigger('submit');
      await flushPromises();
    }
    const panels = wrapper.findAllComponents({ name: 'CodeReviewPanel' });
    for (const [index, agent] of snapshot.agents.slice(0, 2).entries()) {
      const panel = panels.find(panel => panel.props('agent').id === agent.id)!;
      expect(panel.get('.code-review-panel__instructions').text()).toBe(`Focus for pane ${index}`);
    }
    const firstWorkspace = wrapper.findAllComponents({ name: 'RightWorkspacePanel' })
      .find(panel => panel.props('agent').id === snapshot.agents[0]!.id)!;
    await firstWorkspace.get('[aria-label="Close Review tab"]').trigger('click');
    await panes[0]!.trigger('pointerdown');
    await flushPromises();
    const firstEditor = panes[0]!.get('[contenteditable="true"]');
    firstEditor.element.textContent = '/review';
    await firstEditor.trigger('input');
    await panes[0]!.get('form').trigger('submit');
    await flushPromises();
    expect(firstWorkspace.find('.code-review-panel__instructions').exists()).toBe(false);
    const second = panels.find(panel => panel.props('agent').id === snapshot.agents[1]!.id)!;
    await second.get('.code-review-panel__start').trigger('click');
    await flushPromises();
    expect(api.startCodeReview).toHaveBeenCalledWith(snapshot.agents[1]!.id, expect.objectContaining({ instructions: 'Focus for pane 1' }));
    expect(api.sendPrompt).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([
    ['Single Pane', false], ['Vertical Split', false], ['Horizontal Split', false], ['4-Pane Split', false],
    ['Single Pane', true], ['Vertical Split', true],
  ] as const)('focuses navigation in %s (leave before history completes: %s) without stealing pane-control focus', async (layout, leaveBeforeLoad) => {
    const snapshot = createInitialSnapshot();
    const [first, second] = snapshot.agents;
    second!.backendSession = { kind: 'codex', threadId: 'cold-thread' };
    const { api, emit } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot, activeAgentId: id,
      teams: snapshot.teams.map(team => ({ ...team, activeAgentId: id })),
    }));
    let finishHistory = () => {};
    const coldHistory = new Promise<void>(resolve => { finishHistory = resolve; });
    api.loadConversationHistory.mockImplementation(async (id) => {
      if (id === second!.id) {
        await coldHistory;
        emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: second!.id,
          threadId: 'cold-thread', payload: { revision: 1, snapshot: codexConversationSnapshot([], { activeConversationId: 'cold-thread' }) } });
      }
      return snapshot;
    });
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    if (layout !== 'Single Pane') await chooseLayout(wrapper, layout);
    const select = async (id: string) => {
      const row = wrapper.findAll<HTMLButtonElement>('.agent-sidebar__agent').find(row => row.text().includes(snapshot.agents.find(agent => agent.id === id)!.name!))!;
      row.element.focus();
      await row.trigger('click');
      await flushPromises();
    };
    await select(second!.id);
    expect(wrapper.find(`[data-conversation-agent-id="${second!.id}"] [contenteditable="true"]`).exists()).toBe(false);
    if (leaveBeforeLoad) await select(first!.id);
    finishHistory();
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get(`[data-conversation-agent-id="${leaveBeforeLoad ? first!.id : second!.id}"] [contenteditable="true"]`).element);
    // Re-selecting the active agent must focus its composer too.
    await select(first!.id);
    expect(document.activeElement).toBe(wrapper.get(`[data-conversation-agent-id="${first!.id}"] [contenteditable="true"]`).element);
    if (layout !== 'Single Pane') {
      const button = wrapper.get<HTMLButtonElement>(`[data-conversation-agent-id="${second!.id}"] button[aria-label="Composer actions"]`);
      button.element.focus();
      await flushPromises();
      expect(document.activeElement).toBe(button.element);
      expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBe(second!.id);
    }
  });

  it.each([
    ['Vertical Split', 2, 1],
    ['Horizontal Split', 2, 0],
    ['4-Pane Split', 4, 1],
  ] as const)('repeats agent headers in %s with one fixed top-right sidebar toggle', async (layout, count, toggleIndex) => {
    const snapshot = createInitialSnapshot();
    const [first, second] = snapshot.agents;
    for (const [index, agent] of snapshot.agents.entries()) {
      snapshot.agentGitStatuses[agent.id] = {
        folder: agent.folder!, branch: `branch-${index}`, repository: `repo-${index}`,
        ahead: 0, behind: 0, changedFiles: 1, addedLines: 11 + index,
        removedLines: 2 + index, hasUntracked: false, state: 'dirty', updatedAt: agent.updatedAt,
      };
      agent.statusText = `Status for ${agent.name}`;
    }
    const { api } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot, activeAgentId: id,
      teams: snapshot.teams.map(team => ({ ...team, activeAgentId: id })),
    }));
    api.getAgentGitDiff.mockResolvedValue({ target: { type: 'uncommitted' }, summary: { addedLines: 12, removedLines: 3, changedFiles: 1 }, diff: '', sections: [] });
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await chooseLayout(wrapper, layout);
    const panes = wrapper.findAll('.agent-split-grid__pane');
    expect(wrapper.findAll('.agent-header')).toHaveLength(count);
    for (const [index, agent] of snapshot.agents.entries()) {
      const header = panes[index]!.get('.agent-header');
      expect(header.text()).toContain(agent.name);
      expect(header.text()).toContain(`branch-${index} @ repo-${index}`);
      expect(header.text()).toContain(agent.statusText);
      expect(header.text()).toContain(`+${11 + index}`);
    }
    expect(wrapper.findAll('[aria-label="Toggle right workspace"]')).toHaveLength(1);
    const toggle = panes[toggleIndex]!.get('[aria-label="Toggle right workspace"]');
    // This fixed-position control operates on focus, not the pane containing it.
    await toggle.trigger('pointerdown');
    await toggle.trigger('focusin');
    await toggle.trigger('click');
    await flushPromises();
    expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBe(first!.id);
    expect(api.selectAgent).not.toHaveBeenCalled();
    expect(wrapper.findAll('.app-shell__right-workspace').filter(panel => panel.isVisible())).toHaveLength(1);
    if (layout === 'Vertical Split') {
      await panes[0]!.get('[aria-label="Open repository diff"]').trigger('click');
      await flushPromises();
      expect(api.getAgentGitDiff).toHaveBeenCalledExactlyOnceWith(first!.id, { type: 'uncommitted' });
    }
    await panes[1]!.get('.agent-header').trigger('pointerdown');
    await flushPromises();
    expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBe(second!.id);
    expect(panes[toggleIndex]!.get('[aria-label="Toggle right workspace"]').attributes('aria-pressed')).toBe('true');
    const emptyWorkspace = wrapper.findAll('.app-shell__right-workspace').filter(panel => panel.isVisible());
    expect(emptyWorkspace).toHaveLength(1);
    expect(emptyWorkspace[0]!.get('[aria-label="Open a workspace tab"]').isVisible()).toBe(true);
    expect(emptyWorkspace[0]!.findAll('[role="tab"]')).toHaveLength(0);
    if (layout === 'Vertical Split') {
      await panes[1]!.get('[aria-label="Open repository diff"]').trigger('click');
      await flushPromises();
      expect(api.getAgentGitDiff).toHaveBeenLastCalledWith(second!.id, { type: 'uncommitted' });
      expect(wrapper.findAll('.app-shell__right-workspace').filter(panel => panel.isVisible())[0]!.get('[role="tab"][aria-label="Changes"]').attributes('aria-selected')).toBe('true');
      await panes[0]!.get('.agent-header').trigger('pointerdown');
      await flushPromises();
      expect(wrapper.findAll('.app-shell__right-workspace').filter(panel => panel.isVisible())[0]!.get('[role="tab"][aria-label="Changes"]').isVisible()).toBe(true);
      await toggle.trigger('click');
      await panes[1]!.get('.agent-header').trigger('pointerdown');
      await flushPromises();
      expect(wrapper.findAll('.app-shell__right-workspace').filter(panel => panel.isVisible())).toHaveLength(0);
    }
  });

  it('keeps the focused composer selection when shared agent mentions refresh in both panes', async () => {
    const snapshot = createInitialSnapshot();
    const [first, second] = snapshot.agents;
    const { emit, api } = installBackendFixture(snapshot);
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    const editor = wrapper.findAll<HTMLElement>('[contenteditable="true"]')[0]!;
    editor.element.focus();
    editor.element.textContent = 'Keep this draft';
    await editor.trigger('input');
    await flushPromises();
    const range = document.createRange();
    range.setStart(editor.element.firstChild!, 5);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushPromises();

    emit({ type: 'agent.updated', agentId: second!.id, payload: { id: second!.id, name: 'Renamed teammate' } });
    await flushPromises();

    expect(editor.element.contains(window.getSelection()?.anchorNode ?? null)).toBe(true);
    expect(window.getSelection()?.anchorOffset).toBe(5);
    expect(document.activeElement).toBe(editor.element);
    expect(wrapper.get('.agent-split-grid__pane--focused').attributes('data-agent-id')).toBe(first!.id);
    expect(api.selectAgent).not.toHaveBeenCalled();
  });

  it('hides the previous agent workspace while an empty pane is selected', async () => {
    const { api } = installBackendFixture(createInitialSnapshot());
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    const layoutButton = wrapper.get('button[aria-label="Conversation layout"]');
    expect(layoutButton.element.closest('.agent-header')).toBeNull();
    expect(layoutButton.element.closest('.app-shell__conversations')).not.toBeNull();
    expect(getComputedStyle(wrapper.get('.app-shell__conversations').element).position).toBe('relative');
    expect(getComputedStyle(wrapper.get('.app-shell__layout-control').element).position).toBe('absolute');
    expect(getComputedStyle(layoutButton.element).width).toBe('24px');
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await chooseLayout(wrapper, '4-Pane Split');
    await wrapper.findAll('.agent-split-grid__pane')[3]!.trigger('pointerdown');
    expect(
      wrapper
        .findAll('.app-shell__right-workspace')
        .filter((panel) => panel.isVisible()),
    ).toHaveLength(0);
    expect(
      wrapper
        .get('[aria-label="Toggle right workspace"]')
        .attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.findAll('.agent-split-grid__pane')[3]!.find('[aria-label="Run Git action"]').exists()).toBe(false);
    expect(wrapper.find('.app-shell__right-workspace-resizer').exists()).toBe(
      false,
    );
    expect(api.selectAgent).not.toHaveBeenCalled();
  });

  it('loads cold conversations in every layout, keeps panes stable on focus, and shares only the focused sidebar', async () => {
    const snapshot = createInitialSnapshot();
    const agents = snapshot.agents;
    while (agents.length < 4)
      agents.push({
        ...agents[0]!,
        id: `agent-split-${agents.length}`,
        name: `Split ${agents.length}`,
      });
    snapshot.teams[0]!.agentIds = agents.map((agent) => agent.id);
    for (const agent of agents)
      agent.backendSession = { kind: 'codex', threadId: `thread-${agent.id}` };
    const { api, emit } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot,
      activeAgentId: id,
      teams: snapshot.teams.map((team) => ({ ...team, activeAgentId: id })),
    }));
    api.loadConversationHistory.mockImplementation(async (id) => {
      emit({
        type: 'codex.conversationSnapshotChanged',
        backend: 'codex',
        agentId: id,
        threadId: `thread-${id}`,
        payload: {
          revision: 1,
          snapshot: codexConversationSnapshot(
            [
              codexTextMessage(
                `message-${id}`,
                'assistant',
                `Conversation ${id}`,
                `turn-${id}`,
              ),
            ],
            {
              activeConversationId: `thread-${id}`,
              turnIds: [`turn-${id}`],
              executionPlan: {
                turnId: `turn-${id}`,
                explanation: `Plan for ${id}`,
                steps: [{ step: `Work for ${id}`, status: 'inProgress' }],
                markdown: '',
                updatedAt: '2026-09-28T00:00:00Z',
              },
            },
          ),
        },
      });
      return snapshot;
    });
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe(
      '2-vertical',
    );
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(2);
    const firstEditor = wrapper.findAll('[contenteditable="true"]')[0]!.element;
    await wrapper.findAll('.agent-split-grid__pane')[1]!.trigger('pointerdown');
    await flushPromises();
    expect(wrapper.findAll('[contenteditable="true"]')[0]!.element).toBe(
      firstEditor,
    );
    expect(wrapper.get('.agent-split-grid__pane--focused .agent-header').text()).toContain(agents[1]!.name);
    expect(wrapper.get('.conversation-plan').text()).toContain(
      `Work for ${agents[1]!.id}`,
    );
    await wrapper.get('.conversation-plan__close').trigger('click');
    expect(wrapper.find('.conversation-plan').exists()).toBe(false);
    await wrapper.get('[aria-label="Toggle right workspace"]').trigger('click');
    await flushPromises();
    expect(
      wrapper
        .findAll('.app-shell__right-workspace')
        .filter((panel) => panel.isVisible()),
    ).toHaveLength(1);
    await wrapper.findAll('.agent-split-grid__pane')[0]!.trigger('pointerdown');
    await flushPromises();
    expect(
      wrapper
        .findAll('.app-shell__right-workspace')
        .filter((panel) => panel.isVisible()),
    ).toHaveLength(1);
    await wrapper.findAll('.agent-split-grid__pane')[1]!.trigger('pointerdown');
    await flushPromises();
    expect(
      wrapper
        .findAll('.app-shell__right-workspace')
        .filter((panel) => panel.isVisible()),
    ).toHaveLength(1);
    await chooseLayout(wrapper, 'Horizontal Split');
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe(
      '2-horizontal',
    );
    expect(wrapper.findAll('[contenteditable="true"]')[0]!.element).toBe(
      firstEditor,
    );
    await chooseLayout(wrapper, '4-Pane Split');
    expect(wrapper.get('.agent-split-grid').attributes('data-layout')).toBe(
      '4-quadrant',
    );
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(4);
    for (const agent of agents)
      expect(wrapper.text()).toContain(`Conversation ${agent.id}`);
    await wrapper.findAll('.agent-split-grid__pane')[3]!.trigger('pointerdown');
    await chooseLayout(wrapper, 'Single Pane');
    expect(wrapper.findAll('[contenteditable="true"]')).toHaveLength(1);
    expect(wrapper.get('.agent-header').text()).toContain(agents[3]!.name);
  });

  it('keeps draft shortcuts, submissions and late completions tied to their pane rather than the latest focus', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const [first, second] = snapshot.agents;
    const { api, emitAppCommand } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot,
      activeAgentId: id,
      teams: snapshot.teams.map((team) => ({ ...team, activeAgentId: id })),
    }));
    api.updateSettings.mockResolvedValue(snapshot);
    let completeSend = () => {};
    api.sendPrompt.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        completeSend = resolve;
      });
      return snapshot;
    });
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    const panes = wrapper.findAll('.agent-split-grid__pane');
    const firstEditor = panes[0]!.get('[contenteditable="true"]');
    firstEditor.element.textContent = 'First agent draft';
    await firstEditor.trigger('input');
    const secondEditor = panes[1]!.get('[contenteditable="true"]');
    await secondEditor.trigger('focusin');
    secondEditor.element.textContent = 'Second agent draft';
    await secondEditor.trigger('input');
    emitAppCommand({ type: 'save-active-prompt-draft' });
    await flushPromises();
    expect(api.updateSettings).toHaveBeenCalledExactlyOnceWith({
      general: {
        savedPromptDrafts: [
          expect.objectContaining({
            agentId: second!.id,
            text: 'Second agent draft',
          }),
        ],
      },
    });
    expect(firstEditor.text()).toBe('First agent draft');
    await firstEditor.trigger('focusin');
    await panes[0]!.get('[aria-label="Send prompt"]').trigger('click');
    await flushPromises();
    expect(api.sendPrompt).toHaveBeenCalledExactlyOnceWith(
      first!.id,
      'First agent draft',
    );
    await secondEditor.trigger('focusin');
    await flushPromises();
    completeSend();
    await flushPromises();
    expect(wrapper.get('.agent-split-grid__pane--focused .agent-header').text()).toContain(second!.name);
    expect(
      wrapper
        .findAll('.agent-split-grid__pane--focused')[0]!
        .attributes('data-agent-id'),
    ).toBe(second!.id);
  });

  it('does not interrupt the only generating background agent when Escape is pressed in the focused idle pane', async () => {
    const snapshot = createInitialSnapshot();
    const [first, second] = snapshot.agents;
    first!.backendSession = { kind: 'codex', threadId: 'background-thread' };
    const { api, emit } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot,
      activeAgentId: id,
      teams: snapshot.teams.map((team) => ({ ...team, activeAgentId: id })),
    }));
    api.loadConversationHistory.mockResolvedValue(snapshot);
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    const editor = wrapper.findAll('[contenteditable="true"]')[1]!;
    (editor.element as HTMLElement).focus();
    await flushPromises();
    const historyLoads = api.loadConversationHistory.mock.calls.length;
    emit({
      type: 'codex.conversationSnapshotChanged',
      backend: 'codex',
      agentId: first!.id,
      threadId: 'background-thread',
      payload: {
        revision: 1,
        snapshot: codexConversationSnapshot(
          [codexTextMessage('working', 'assistant', 'Working')],
          {
            busy: true,
            activeTurnId: 'turn',
            activeConversationId: 'background-thread',
          },
        ),
      },
    });
    await flushPromises();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await flushPromises();
    expect(api.interruptAgent).not.toHaveBeenCalled();
    expect(api.loadConversationHistory).toHaveBeenCalledTimes(historyLoads);
    expect(
      wrapper
        .get('.agent-split-grid__pane--focused')
        .attributes('data-agent-id'),
    ).toBe(second!.id);
  });

  it('applies a model favorite to its own pane and sends that configuration', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const second = snapshot.agents[1]!;
    snapshot.general.modelFavorites = [
      {
        backend: 'codex',
        modelId: 'test-model',
        reasoningEffort: 'high',
        serviceTier: null,
      },
    ];
    const { api } = installBackendFixture(snapshot);
    api.selectAgent.mockImplementation(async (id) => ({
      ...snapshot,
      activeAgentId: id,
      teams: snapshot.teams.map((team) => ({ ...team, activeAgentId: id })),
    }));
    api.listBackendModels.mockResolvedValue([
      {
        id: 'test-model',
        model: 'test-model',
        displayName: 'Test model',
        isDefault: true,
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: '' },
          { reasoningEffort: 'high', description: '' },
        ],
        defaultReasoningEffort: 'medium',
      },
    ]);
    api.sendPrompt.mockResolvedValue(snapshot);
    const wrapper = mount(App, {
      attachTo: document.body,
    });
    await flushPromises();
    await chooseLayout(wrapper, 'Vertical Split');
    const pane = wrapper.findAll('.agent-split-grid__pane')[1]!;
    await pane.trigger('pointerdown');
    await flushPromises();
    await pane.get('[aria-label="Model and reasoning"]').trigger('click');
    const favorite = pane
      .findAll('[role="menuitem"]')
      .find(
        (item) =>
          item.text().includes('Test model') && item.text().includes('High'),
      );
    expect(favorite).toBeDefined();
    await favorite!.trigger('click');
    const editor = pane.get('[contenteditable="true"]');
    editor.element.textContent = 'Use my favorite';
    await editor.trigger('input');
    await pane.get('[aria-label="Send prompt"]').trigger('click');
    await flushPromises();
    expect(api.sendPrompt).toHaveBeenCalledWith(
      second.id,
      'Use my favorite',
      expect.objectContaining({ selection: { model: 'test-model', reasoningEffort: 'high' } }),
    );
  });
});
