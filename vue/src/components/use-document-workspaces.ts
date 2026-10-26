import { onScopeDispose, watch } from 'vue';
import type { AppApi } from '@workspace/core/contracts';
import type { DocumentWorkspace, DocumentWorkspaceTab, DocumentWorkspaces } from '@workspace/core/document-workspace';
import type { AgentRightWorkspaceState } from './use-right-workspace-state';
import { isRightWorkspaceBrowserTab, isRightWorkspaceFileTab, type RightWorkspaceTab } from './right-workspace';

const persistDebounceMs = 250;

/** Persist references and layout; never serialize content, provider state or handles. */
export function useDocumentWorkspaces(options: {
  api?: Pick<AppApi, 'getDocumentWorkspaces' | 'updateDocumentWorkspace' | 'readWorkspaceDocument' | 'saveWorkspaceDocument'>;
  workspaces: Record<string, AgentRightWorkspaceState>;
  canUseWorkspace: (agentId: string) => boolean;
  workspaceFor: (agentId: string) => AgentRightWorkspaceState;
  reportError: (error: string) => void;
}) {
  let disposed = false;
  let restoring = true;
  const closedDuringRestore = new Map<string, Set<string>>();
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: DocumentWorkspaces = {};
  let pending: Promise<unknown> = Promise.resolve();
  const api = options.api;
  const ready = initialize();
  onScopeDispose(() => {
    disposed = true;
    stop?.();
    if (timer !== undefined) { clearTimeout(timer); persist(capture()); }
  });

  function descriptor(workspace: AgentRightWorkspaceState): DocumentWorkspace {
    return {
      tabs: workspace.tabs.flatMap<DocumentWorkspaceTab>(id => {
        if (id === 'browser' && !workspace.browserVisualization) {
          return [{ id, title: id, browser: { id: workspace.browserId, url: workspace.browserInitialUrl } }];
        }
        if (isRightWorkspaceBrowserTab(id)) {
          const browser = workspace.browserPanels[id];
          return [{ id, title: browser?.title ?? id, ...(browser ? { browser: { id: browser.browserId, url: browser.url } } : {}) }];
        }
        const panel = isRightWorkspaceFileTab(id) ? workspace.filePanels[id] : undefined;
        // Provider plan/diff/image payloads remain owned by their original surfaces.
        if (isRightWorkspaceFileTab(id) && !panel?.documentId && !panel?.path && !panel?.savedPath) return [];
        if (id.startsWith('diff:') || id.startsWith('image:') || id === 'plan') return [];
        return [{ id, title: panel?.title ?? id, ...(panel?.documentId ? { documentId: panel.documentId } : {}), ...(panel?.savedPath ? { savedPath: panel.savedPath } : panel?.path ? { path: panel.path } : {}) }];
      }),
      activeTab: workspace.activeTab, open: workspace.open, width: workspace.width,
      filesPaneOpen: workspace.filesPaneOpen, filesPaneWidth: workspace.filesPaneWidth,
    };
  }

  async function initialize(): Promise<void> {
    if (!api) return;
    try {
      const restored = await api.getDocumentWorkspaces();
      if (disposed) return;
      for (const [agentId, saved] of Object.entries(restored)) {
        if (!options.canUseWorkspace(agentId)) continue;
        const workspace = options.workspaceFor(agentId);
        const hadLocalTabs = workspace.tabs.length > 0 || closedDuringRestore.has(agentId);
        for (const tab of saved.tabs) {
          if (closedDuringRestore.get(agentId)?.has(tab.id)) continue;
          const alreadyOpen = workspace.tabs.includes(tab.id as RightWorkspaceTab);
          if (!alreadyOpen) {
            workspace.tabs.push(tab.id as RightWorkspaceTab);
            if (tab.browser && tab.id === 'browser') {
              workspace.browserId = tab.browser.id;
              workspace.browserInitialUrl = tab.browser.url;
            } else if (tab.browser && isRightWorkspaceBrowserTab(tab.id as RightWorkspaceTab)) {
              workspace.browserPanels[tab.id as `browser:${string}`] = { browserId: tab.browser.id, url: tab.browser.url, title: tab.title };
            }
          }
          if (isRightWorkspaceFileTab(tab.id as RightWorkspaceTab)) restorePanel(agentId, tab);
        }
        if (!hadLocalTabs) {
          workspace.activeTab = saved.activeTab as RightWorkspaceTab | null;
          workspace.open = saved.open;
          workspace.width = saved.width;
          workspace.filesPaneOpen = saved.filesPaneOpen;
          workspace.filesPaneWidth = saved.filesPaneWidth;
        }
      }
      restoring = false;
      closedDuringRestore.clear();
      previous = restored;
      persist(capture());
      stop = watch(capture, schedulePersist, { deep: true });
    } catch (error) { options.reportError(String(error)); }
  }

  function restorePanel(agentId: string, tab: DocumentWorkspaceTab): void {
    const workspace = options.workspaceFor(agentId);
    const id = tab.id as `file:${string}`;
    if (workspace.filePanels[id]) return;
    const filePath = tab.savedPath ?? tab.path;
    workspace.filePanels[id] = {
      kind: tab.documentId || /\.(md|markdown|mdown|mkdn)$/iu.test(filePath ?? '') ? 'markdown' : 'source',
      title: tab.title, content: '', state: 'loading',
      ...(tab.documentId ? { documentId: tab.documentId } : {}),
      ...(tab.savedPath ? { savedPath: tab.savedPath } : {}),
      ...(tab.path ? { path: tab.path } : {}),
      ...(filePath ? { subtitle: filePath } : {}),
    };
    const panel = workspace.filePanels[id]!;
    void api!.readWorkspaceDocument(agentId, tab.id).then(result => {
      if (disposed || workspace.filePanels[id] !== panel) return;
      panel.content = result.content;
      panel.state = result.error ? 'error' : 'idle';
      panel.error = result.error ?? null;
    }).catch(error => {
      if (disposed || workspace.filePanels[id] !== panel) return;
      panel.state = 'error'; panel.error = String(error);
    });
  }

  function capture(): DocumentWorkspaces {
    return Object.fromEntries(Object.entries(options.workspaces).filter(([id]) => options.canUseWorkspace(id)).map(([id, workspace]) => [id, descriptor(workspace)]));
  }

  /**
   * Coalesce bursts such as panel-resize drags into one backend transaction. Tab
   * openings and closings go out immediately: the backend may already hold a tab
   * this client has not yet reported, so an open-then-close must not collapse.
   */
  function schedulePersist(next: DocumentWorkspaces): void {
    const tabIds = (workspaces: DocumentWorkspaces) => JSON.stringify(Object.entries(workspaces).map(([id, workspace]) => [id, workspace.tabs.map(tab => tab.id)]));
    if (tabIds(next) !== tabIds(previous)) { persist(next); return; }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; persist(capture()); }, persistDebounceMs);
  }

  function persist(next: DocumentWorkspaces): void {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    for (const [agentId, workspace] of Object.entries(next)) {
      const before = previous[agentId];
      if (JSON.stringify(before) === JSON.stringify(workspace)) continue;
      const change = {
        upsert: workspace.tabs.filter(tab => !before?.tabs.some(old => JSON.stringify(old) === JSON.stringify(tab))),
        close: before?.tabs.filter(tab => !workspace.tabs.some(next => next.id === tab.id)).map(tab => tab.id) ?? [],
        activeTab: workspace.activeTab, open: workspace.open, width: workspace.width,
        filesPaneOpen: workspace.filesPaneOpen, filesPaneWidth: workspace.filesPaneWidth,
      };
      pending = pending.catch(() => undefined).then(() => {
        if (options.canUseWorkspace(agentId)) return api!.updateDocumentWorkspace(agentId, change);
      });
      void pending.catch(error => options.reportError(String(error)));
    }
    previous = next;
  }

  async function save(agentId: string, tabId: string, filePath: string, overwrite = false): Promise<void> {
    if (!api || !options.canUseWorkspace(agentId)) return;
    await ready;
    persist(capture());
    await pending;
    const result = await api.saveWorkspaceDocument(agentId, { tabId, path: filePath, overwrite });
    const workspace = options.workspaceFor(agentId);
    const tab = result.tabs.find(tab => tab.id === tabId);
    if (!tab || !workspace.tabs.includes(tabId as RightWorkspaceTab)) return;
    const panel = workspace.filePanels[tabId as `file:${string}`];
    if (!panel) return;
    delete panel.documentId;
    delete panel.path;
    panel.savedPath = tab.savedPath;
    panel.subtitle = tab.savedPath;
    panel.title = tab.title;
  }

  function recordClose(agentId: string, tabId: string): void {
    if (!restoring) return;
    const closed = closedDuringRestore.get(agentId) ?? new Set<string>();
    closed.add(tabId);
    closedDuringRestore.set(agentId, closed);
  }

  return { ready, save, recordClose };
}
