import { flushPromises, mount } from '@vue/test-utils';
import AppShell from '../../src/components/AppShell.vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { mountShell } from '../support/app-shell-test-harness';
import { setElectronTestClient } from '../support/client';

function stubViewport(compact: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: compact,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('AppShell on a compact viewport', () => {
  it('keeps navigation in a drawer that the header toggle opens and the backdrop closes', async () => {
    stubViewport(true);
    const wrapper = mountShell({ snapshot: createInitialSnapshot(), stubAgentWorkspace: false });
    try {
      await flushPromises();
      const nav = wrapper.get('.app-shell__nav');
      expect(nav.classes()).toContain('app-shell__nav--compact');
      expect(nav.classes()).not.toContain('app-shell__nav--open');

      await wrapper.get('.agent-header .sidebar-expand-button').trigger('click');
      expect(nav.classes()).toContain('app-shell__nav--open');

      await wrapper.get('.app-shell__nav-backdrop').trigger('click');
      expect(nav.classes()).not.toContain('app-shell__nav--open');
      expect(wrapper.find('.app-shell__nav-backdrop').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('closes the drawer when a dialog opens over it', async () => {
    stubViewport(true);
    const wrapper = mountShell({ snapshot: createInitialSnapshot(), stubAgentWorkspace: false });
    try {
      await flushPromises();
      await wrapper.get('.agent-header .sidebar-expand-button').trigger('click');
      expect(wrapper.get('.app-shell__nav').classes()).toContain('app-shell__nav--open');

      await wrapper.get('.team-rail__new').trigger('click');
      await flushPromises();

      expect(wrapper.get('.app-shell__nav').classes()).not.toContain('app-shell__nav--open');
    } finally { wrapper.unmount(); }
  });

  it('keeps an open project overview in a narrow window instead of returning to a conversation', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.general.projectFlowEnabled = true;
    const agent = snapshot.agents[0]!;
    agent.folder = '/work/korus';
    agent.workspace = { kind: 'git', folder: '/work/korus', repositoryName: 'korus', repositoryRoot: '/work/korus', primaryWorktreeRoot: '/work/korus', branch: 'main', isLinkedWorktree: false, updatedAt: '2026-11-11T00:00:00Z' };
    const absent = { status: 'notConnected' as const, count: null, note: null, marks: [], stuck: [] };
    setElectronTestClient({
      getProjectOverview: vi.fn(async () => ({
        generatedAt: new Date().toISOString(), lookback: { days: 30, since: new Date().toISOString() }, toolLinks: {},
        repository: { name: 'korus', branch: 'main', baseBranch: 'main' },
        sources: { git: 'available' as const, backlog: 'notConnected' as const, pullRequests: 'notConnected' as const, pipelines: 'notConnected' as const },
        narrative: { status: 'unavailable' as const, reason: 'quiet' as const },
        flow: { stations: (['backlog', 'building', 'review', 'ci', 'shipped'] as const).map(kind => ({ kind, ...absent })), links: [], constraint: null },
      })),
      refreshProjectNarrative: vi.fn(),
    });
    // Opened in a wide window, then the window is narrowed past the compact breakpoint.
    const query = { matches: false, listener: null as ((event: { matches: boolean }) => void) | null };
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      get matches() { return query.matches; },
      addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => { query.listener = listener; }),
      removeEventListener: vi.fn(),
    }));
    const wrapper = mount(AppShell, { attachTo: document.body, props: { snapshot, activeAgent: agent, isLoading: false, isSending: false } });
    try {
      await flushPromises();
      await wrapper.get('[data-entry="project-overview"]').trigger('click');
      await flushPromises();
      query.matches = true;
      query.listener?.({ matches: true });
      await flushPromises();
      expect(wrapper.get('.app-shell__nav').classes()).toContain('app-shell__nav--compact');
      expect(wrapper.find('.project-overview').exists()).toBe(true);
      expect(wrapper.findAll('.project-flow__station')).toHaveLength(5);
    } finally { wrapper.unmount(); }
  });

  it('limits phones to conversations and the cockpit', async () => {
    stubViewport(true);
    const wrapper = mountShell({ snapshot: createInitialSnapshot(), stubAgentWorkspace: false });
    try {
      await flushPromises();
      expect(wrapper.find('.team-rail__cockpit').exists()).toBe(true);
      expect(wrapper.find('.team-rail__backlog').exists()).toBe(false);
      expect(wrapper.find('.team-rail__automations').exists()).toBe(false);
      expect(wrapper.find('.settings-menu__trigger').exists()).toBe(false);
      expect(wrapper.find('.agent-sidebar__mission-action').exists()).toBe(false);
      expect(wrapper.find('.split-layout-control').exists()).toBe(false);
    } finally { wrapper.unmount(); }
  });

  it('keeps every surface on a wide viewport', async () => {
    stubViewport(false);
    const wrapper = mountShell({ snapshot: createInitialSnapshot(), stubAgentWorkspace: false });
    try {
      await flushPromises();
      expect(wrapper.find('.app-shell__nav--compact').exists()).toBe(false);
      expect(wrapper.find('.team-rail__backlog').exists()).toBe(true);
      expect(wrapper.find('.team-rail__automations').exists()).toBe(true);
      expect(wrapper.find('.settings-menu__trigger').exists()).toBe(true);
    } finally { wrapper.unmount(); }
  });
});
