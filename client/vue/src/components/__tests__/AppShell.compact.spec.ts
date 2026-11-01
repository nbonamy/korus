import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { mountShell } from './app-shell-test-harness';

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
