import type { AgentPaneSetup, WindowSetup } from '@workspace/core/windows';
import { isRightWorkspaceBrowserTab, type RightWorkspaceTab } from './right-workspace';
import type { AgentRightWorkspaceState } from './use-right-workspace-state';

// Tabs that carry nothing but where to look: they can be opened again anywhere. Tabs holding a file, a diff,
// an image, a plan or a subagent conversation depend on content only their window has, so they stay behind.
const portableTabs = new Set<string>(['gitLog', 'simulator', 'visualize', 'design', 'review', 'backlog', 'browser', 'files']);
const isPortableTab = (tab: string): boolean => portableTabs.has(tab) || tab.startsWith('browser:');

/** What each agent has open in this window that is worth bringing to another window or back after a relaunch. */
export function exportWorkspaceSetup(workspaces: Readonly<Record<string, AgentRightWorkspaceState>>): WindowSetup {
  const setup: WindowSetup = {};
  for (const [agentId, workspace] of Object.entries(workspaces)) {
    const tabs: string[] = workspace.tabs.filter(isPortableTab);
    if (!tabs.length) continue;
    const browserPanels = Object.fromEntries(Object.entries(workspace.browserPanels)
      .filter(([tab, panel]) => panel && tabs.includes(tab))
      .map(([tab, panel]) => [tab, { browserId: panel!.browserId, url: panel!.url, title: panel!.title }]));
    setup[agentId] = {
      open: workspace.open,
      width: workspace.width,
      activeTab: workspace.activeTab && tabs.includes(workspace.activeTab) ? workspace.activeTab : tabs[0]!,
      tabs,
      ...(tabs.includes('browser') && workspace.browserInitialUrl ? { browserUrl: workspace.browserInitialUrl } : {}),
      ...(Object.keys(browserPanels).length ? { browserPanels } : {}),
    };
  }
  return setup;
}

/**
 * Brings one agent's saved panes into a window. `replace` is how a window starts: its tabs become the saved ones.
 * `patch` is what a Browser moved here brings along: its pages and tabs are added, and the window keeps its own choice of
 * what is open, how wide, and which tab is in front.
 */
export function applyAgentSetup(workspace: AgentRightWorkspaceState, setup: AgentPaneSetup, mode: 'replace' | 'patch'): void {
  const tabs = setup.tabs.filter(isPortableTab) as RightWorkspaceTab[];
  if (!tabs.length) return;
  const empty = workspace.tabs.length === 0;
  workspace.tabs = mode === 'replace' ? tabs : [...workspace.tabs, ...tabs.filter(tab => isRightWorkspaceBrowserTab(tab) || tab === 'browser').filter(tab => !workspace.tabs.includes(tab))];
  if (tabs.includes('browser')) workspace.browserInitialUrl = setup.browserUrl ?? '';
  const panels = Object.entries(setup.browserPanels ?? {}).filter(([tab]) => tabs.includes(tab as RightWorkspaceTab));
  workspace.browserPanels = mode === 'replace'
    ? Object.fromEntries(panels)
    : { ...workspace.browserPanels, ...Object.fromEntries(panels) };
  if (mode === 'replace' || empty) {
    workspace.activeTab = setup.activeTab && workspace.tabs.includes(setup.activeTab as RightWorkspaceTab) ? setup.activeTab as RightWorkspaceTab : workspace.tabs[0] ?? null;
    workspace.open = setup.open;
    workspace.width = setup.width;
  }
}
