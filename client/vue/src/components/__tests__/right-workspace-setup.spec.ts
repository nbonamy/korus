import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { applyAgentSetup, exportWorkspaceSetup } from '../right-workspace-setup';
import type { AgentRightWorkspaceState } from '../use-right-workspace-state';

function workspace(overrides: Partial<AgentRightWorkspaceState> = {}): AgentRightWorkspaceState {
  return {
    activeTab: null, browserId: 'primary', browserInitialUrl: '', browserOpenRequestId: 0, browserVisualization: null, browserPanels: {},
    filePanels: {}, filesPaneOpen: false, filesPaneWidth: 280, filePreviewRequestIds: {}, diffPanels: {}, gitReviewPanel: null,
    imagePanels: {}, planPanel: null, open: false, tabs: [], width: 420, ...overrides,
  };
}

describe('exporting a window’s panes', () => {
  it('keeps the tabs that can open again anywhere, with their pages, and leaves out the rest', () => {
    const setup = exportWorkspaceSetup(reactive({
      'agent-a': workspace({
        open: true, width: 500, activeTab: 'browser', browserInitialUrl: 'https://example.com/',
        tabs: ['review', 'file:src%2Fmain.ts', 'browser', 'browser:second', 'diff:x', 'plan'],
        browserPanels: { 'browser:second': { browserId: 'second', url: 'https://docs.test/', title: 'docs.test' } },
      }),
      'agent-b': workspace({ open: true, tabs: ['file:a.md', 'image:1'] }),
      'agent-c': workspace(),
    }));
    expect(setup).toEqual({
      'agent-a': {
        open: true, width: 500, activeTab: 'browser', tabs: ['review', 'browser', 'browser:second'],
        browserUrl: 'https://example.com/',
        browserPanels: { 'browser:second': { browserId: 'second', url: 'https://docs.test/', title: 'docs.test' } },
      },
    });
  });

  it('falls back to the first tab that stays when the front one does not', () => {
    const setup = exportWorkspaceSetup({ 'agent-a': workspace({ open: true, activeTab: 'plan', tabs: ['plan', 'gitLog'] }) });
    expect(setup['agent-a']).toMatchObject({ activeTab: 'gitLog', tabs: ['gitLog'] });
  });

  it('does not mention a page for a Browser tab that is not open', () => {
    const setup = exportWorkspaceSetup({ 'agent-a': workspace({ open: true, tabs: ['review'], browserInitialUrl: 'https://stale.test/' }) });
    expect(setup['agent-a']).not.toHaveProperty('browserUrl');
  });
});

describe('applying saved panes', () => {
  const saved = {
    open: true, width: 520, activeTab: 'browser', tabs: ['review', 'browser', 'browser:second', 'file:x'],
    browserUrl: 'https://example.com/',
    browserPanels: { 'browser:second': { browserId: 'second', url: 'https://docs.test/', title: 'docs.test' } },
  };

  it('starts a window from them: tabs, front tab, width, open state and every page', () => {
    const target = workspace();
    applyAgentSetup(target, saved, 'replace');
    expect(target).toMatchObject({
      open: true, width: 520, activeTab: 'browser', tabs: ['review', 'browser', 'browser:second'],
      browserInitialUrl: 'https://example.com/',
      browserPanels: { 'browser:second': { browserId: 'second', url: 'https://docs.test/', title: 'docs.test' } },
    });
  });

  it('replaces what the window had when it starts', () => {
    const target = workspace({ open: false, tabs: ['gitLog'], activeTab: 'gitLog', width: 300 });
    applyAgentSetup(target, saved, 'replace');
    expect(target.tabs).toEqual(['review', 'browser', 'browser:second']);
    expect(target.open).toBe(true);
  });

  it('adds a moved Browser’s pages to a window without touching what it has open or how wide', () => {
    const target = workspace({ open: true, width: 333, activeTab: 'review', tabs: ['review'] });
    applyAgentSetup(target, saved, 'patch');
    expect(target).toMatchObject({
      open: true, width: 333, activeTab: 'review', tabs: ['review', 'browser', 'browser:second'],
      browserInitialUrl: 'https://example.com/',
    });
    expect(target.browserPanels['browser:second']?.url).toBe('https://docs.test/');
  });

  it('opens an empty window on the moved Browser', () => {
    const target = workspace();
    applyAgentSetup(target, saved, 'patch');
    expect(target).toMatchObject({ open: true, activeTab: 'browser', width: 520 });
  });

  it('ignores a setup with nothing it can open', () => {
    const target = workspace({ tabs: ['review'] });
    applyAgentSetup(target, { open: true, width: 400, activeTab: null, tabs: ['file:x'] }, 'replace');
    expect(target.tabs).toEqual(['review']);
  });
});
