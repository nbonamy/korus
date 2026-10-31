import { readConversationDiff } from '@workspace/core/conversation-diffs';
import { diffForPath } from '@workspace/core/file-diff';
import { watch } from 'vue';
import type { FileKind } from '@workspace/core/file-kind';
import { agentConversationId } from '@workspace/core/plan-review';
import type {
  Agent,
  AgentFileActivity,
  AgentFilePreviewResult,
  AppSnapshot,
  ConversationFileLink,
  SidePanelMarkdownRequest,
  SidePanelRequest,
} from '@workspace/core/contracts';
import { languageForFilePath } from '@codex-app-sdk/vue';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';
import type { SidePanelGitDiffState } from './side-panel';
import {
  isRightWorkspaceFileTab,
  rightWorkspaceDiffTab,
  rightWorkspaceFileTab,
  rightWorkspaceImageTab,
  rightWorkspaceMarkdownTab,
  type RightWorkspaceFilePanel,
  type RightWorkspaceTab,
} from './right-workspace';
import type { AgentRightWorkspaceState } from './use-right-workspace-state';

export type WorkspacePreviewOptions = {
  readConversationContent?: (agentId: string, input: import('@workspace/core/contracts/conversation').ConversationContentInput) => Promise<import('@workspace/core/contracts/conversation').ConversationContentChunk>;
  closeTab: (agentId: string, tab: RightWorkspaceTab) => void;
  currentAgent: () => Agent | null;
  getSnapshot: () => AppSnapshot;
  getAgentGitDiff: (agentId: string, target?: import('@workspace/core/contracts').AgentGitDiffTarget) => Promise<import('@workspace/core/contracts').AgentGitDiff>;
  openTab: (tab: RightWorkspaceTab, agentId?: string) => void;
  previewAgentFile: (agentId: string, filePath: string) => Promise<AgentFilePreviewResult>;
  downloadAgentFile: (agentId: string, filePath: string) => Promise<void>;
  reportError: (message: string) => void;
  workspaceFor: (agentId: string) => AgentRightWorkspaceState;
};

/** Owns preview request races and projection into per-agent workspace tabs. */
export function useWorkspacePreviews(options: WorkspacePreviewOptions) {
  // A displayed copy of a native proposal has one review surface. Match content,
  // never titles; leave source/saved files and other agents' documents alone.
  watch(() => options.getSnapshot().agents.flatMap(agent => {
    const review = agent.planReview;
    if (!review || !['pending', 'revise'].includes(review.status)
      || review.conversationId !== agentConversationId(agent) || !review.markdown.trim()) return [];
    const workspace = options.workspaceFor(agent.id);
    return workspace.tabs.flatMap(tab => {
      const panel = isRightWorkspaceFileTab(tab) ? workspace.filePanels[tab] : undefined;
      return panel?.kind === 'markdown' && panel.state === 'idle' && !panel.path && !panel.savedPath
        && panel.content.trim().replace(/\r\n/gu, '\n') === review.markdown.trim().replace(/\r\n/gu, '\n')
        ? [{ agentId: agent.id, tab }] : [];
    });
  }), duplicates => {
    for (const { agentId, tab } of duplicates) {
      options.openTab('plan', agentId);
      options.closeTab(agentId, tab);
    }
  // Let document persistence observe a newly opened tab before closing its copy.
  }, { immediate: true, flush: 'post' });

  let filePreviewRequestId = 0;
  const gitDiffRequestIds = new Map<string, number>();
  const contentRequestIds = new Map<string, number>();
  let gitDiffFocusSequence = 0;

  async function openConversationFile(link: ConversationFileLink, agentId = options.currentAgent()?.id, downloadUnsupported = true): Promise<void> {
    const agent = agentId ? agentForId(agentId) : null;
    if (!agent) return;
    const filePath = link.filepath ?? link.path;
    if (link.diffContent) {
      const content = link.diffContent;
      if (agent.backendSession?.kind !== 'codex' || agent.backendSession.threadId !== content.sessionId) return;
      const workspace = options.workspaceFor(agent.id);
      const tab = rightWorkspaceDiffTab(content.contentId, filePath);
      const requestId = ++filePreviewRequestId;
      const requestKey = JSON.stringify([agent.id, tab]);
      contentRequestIds.set(requestKey, requestId);
      workspace.diffPanels = { ...workspace.diffPanels, [tab]: { kind: 'gitDiff', title: fileBasename(filePath), subtitle: filePath, diff: '', state: 'loading', error: null } };
      options.openTab(tab, agent.id);
      const current = () => contentRequestIds.get(requestKey) === requestId && agentForId(agent.id)?.backendSession?.kind === 'codex'
        && agentConversationId(agentForId(agent.id)!) === content.sessionId;
      try {
        if (!options.readConversationContent) throw new Error('Update the desktop to load this diff.');
        const diff = await readConversationDiff(filePath, content, input => options.readConversationContent!(agent.id, input), current);
        if (current() && workspace.diffPanels[tab]) workspace.diffPanels[tab] = { ...workspace.diffPanels[tab]!, diff, state: 'idle', error: null };
      } catch (error) {
        if (current() && workspace.diffPanels[tab]) workspace.diffPanels[tab] = { ...workspace.diffPanels[tab]!, state: 'error', error: error instanceof Error ? error.message : String(error) };
      }
      return;
    }
    if (link.action === 'edit') {
      if (link.turnId && openTurnDiff(agent.id, link.turnId, filePath)) return;
      await openAgentGitDiff(agent.id);
      return;
    }
    await openFile(agent.id, filePath, true, downloadUnsupported);
  }

  function openTurnDiff(agentId: string, turnId: string, filePath: string): boolean {
    const agent = agentForId(agentId);
    const relativePath = normalizePreviewFilePath(filePath, agent?.folder);
    const turnDiff = options.getSnapshot().turnGitDiffs[turnId]?.diff;
    if (!agent || !relativePath || !turnDiff) return false;

    const diff = diffForPath(turnDiff, relativePath);
    if (!diff) return false;

    const workspace = options.workspaceFor(agentId);
    const tab = rightWorkspaceDiffTab(turnId, relativePath);
    workspace.diffPanels = {
      ...workspace.diffPanels,
      [tab]: {
        kind: 'gitDiff',
        title: fileBasename(relativePath),
        subtitle: relativePath,
        diff,
        state: 'idle',
        error: null,
      },
    };
    options.openTab(tab, agentId);
    return true;
  }

  function handleFileActivity(activity: AgentFileActivity): void {
    const agent = agentForId(activity.agentId);
    const filePath = normalizePreviewFilePath(activity.path, agent?.folder);
    if (!agent || !filePath) return;

    const workspace = options.workspaceFor(agent.id);
    const tab = rightWorkspaceFileTab(filePath);
    if (activity.action === 'read' || activity.status !== 'completed' || !workspace.filePanels[tab]) return;
    void openFile(agent.id, filePath, false);
  }

  async function openFile(agentId: string, filePath: string, reveal = true, downloadUnsupported = false): Promise<void> {
    const agent = agentForId(agentId);
    const trimmedPath = normalizePreviewFilePath(filePath, agent?.folder);
    if (!agent || !trimmedPath) return;

    const workspace = options.workspaceFor(agent.id);
    const tab = rightWorkspaceFileTab(trimmedPath);
    const requestId = ++filePreviewRequestId;
    workspace.filePreviewRequestIds = { ...workspace.filePreviewRequestIds, [tab]: requestId };
    const existingContent = workspace.filePanels[tab]?.content ?? '';
    function revealPanel() {
      workspace.filePanels = {
        ...workspace.filePanels,
        [tab]: filePreviewPanel(trimmedPath, existingContent, 'loading', null),
      };
      if (reveal && workspace.activeTab === 'files' && workspace.tabs.includes('files')) {
        workspace.tabs = workspace.tabs
          .map((candidate) => candidate === 'files' ? tab : candidate)
          .filter((candidate, index, tabs) => tabs.indexOf(candidate) === index);
        workspace.activeTab = tab;
        workspace.open = true;
      } else if (reveal) {
        options.openTab(tab, agentId);
      }
    }
    if (!downloadUnsupported) revealPanel();

    try {
      const result = await options.previewAgentFile(agent.id, trimmedPath);
      if (workspace.filePreviewRequestIds[tab] !== requestId) return;
      if (reveal && !downloadUnsupported && (!workspace.open || !workspace.tabs.includes(tab))) return;
      if (downloadUnsupported && (result.kind === 'binary' || result.kind === 'tooLarge')) {
        try {
          await options.downloadAgentFile(agent.id, trimmedPath);
        } catch (error) {
          options.reportError(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      if (downloadUnsupported) revealPanel();
      if (result.kind === 'image' && result.dataUrl) {
        const imageTab = rightWorkspaceImageTab(`workspace:${result.path}`);
        workspace.imagePanels = {
          ...workspace.imagePanels,
          [imageTab]: {
            kind: 'image', title: fileBasename(result.path), subtitle: result.path,
            alt: result.path, path: result.path, src: result.dataUrl, mimeType: result.mimeType,
            state: 'idle', error: null,
          },
        };
        options.closeTab(agent.id, tab);
        options.openTab(imageTab, agent.id);
        return;
      }
      if (result.kind === 'text' && /\.(?:diff|patch)$/iu.test(result.path)) {
        const diffTab = rightWorkspaceDiffTab('workspace', result.path);
        workspace.diffPanels = {
          ...workspace.diffPanels,
          [diffTab]: {
            kind: 'gitDiff', title: fileBasename(result.path), subtitle: result.path,
            diff: result.content ?? '', state: 'idle', error: null,
          },
        };
        options.closeTab(agent.id, tab);
        options.openTab(diffTab, agent.id);
        return;
      }
      const unavailable = result.kind === 'tooLarge'
        ? `Preview unavailable: this file is ${formatFileSize(result.size)} and exceeds the preview limit.`
        : result.kind === 'binary'
          ? translate('surface.appShell.previewUnavailableThisIsABinaryOrUnsupportedFile')
          : result.content ?? '';
      workspace.filePanels = {
        ...workspace.filePanels,
        [tab]: filePreviewPanel(result.path, unavailable, 'idle', null),
      };
    } catch (error) {
      if (workspace.filePreviewRequestIds[tab] !== requestId) return;
      if (downloadUnsupported) revealPanel();
      workspace.filePanels = {
        ...workspace.filePanels,
        [tab]: filePreviewPanel(
          trimmedPath,
          existingContent,
          'error',
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  async function openAgentGitDiff(
    agentId: string,
    target?: import('@workspace/core/contracts').AgentGitDiffTarget,
    focusKind?: FileKind,
  ): Promise<void> {
    const agent = agentForId(agentId);
    if (!agent?.folder) return;

    const workspace = options.workspaceFor(agent.id);
    const requestId = (gitDiffRequestIds.get(agent.id) ?? 0) + 1;
    gitDiffRequestIds.set(agent.id, requestId);
    const focus = focusKind ? { focusKind, focusSequence: ++gitDiffFocusSequence } : {};
    workspace.gitReviewPanel = { ...gitReviewPanel(agent.folder, 'loading', null, target), ...focus };
    options.openTab('review', agent.id);
    try {
      const result = await options.getAgentGitDiff(agent.id, target);
      if (gitDiffRequestIds.get(agent.id) !== requestId) return;
      workspace.gitReviewPanel = {
        ...gitReviewPanel(agent.folder, 'idle', null, result.target),
        ...focus,
        diff: result.diff,
        summary: result.summary,
        sections: result.sections,
      };
    } catch (error) {
      if (gitDiffRequestIds.get(agent.id) !== requestId) return;
      workspace.gitReviewPanel = gitReviewPanel(
        agent.folder,
        'error',
        error instanceof Error ? error.message : String(error),
        target,
      );
    }
  }

  function openSidePanel(request: SidePanelRequest): void {
    if (request.kind === 'markdown') {
      openMarkdown(request);
      return;
    }
    openGitDiff(request);
  }

  function openMarkdown(request: SidePanelMarkdownRequest): void {
    const agent = request.agentId ? agentForId(request.agentId) : options.currentAgent();
    if (!agent) return;
    const subtitle = request.path;
    const workspace = options.workspaceFor(agent.id);
    const title = localizedText(request.title, translate)
      ?? (subtitle ? fileBasename(subtitle) : translate('surface.appShell.markdown'));
    if (request.purpose !== 'plan') {
      const identifier = request.documentId ?? request.path ?? crypto.randomUUID();
      const tab = request.path ? rightWorkspaceFileTab(request.path) : rightWorkspaceMarkdownTab(identifier);
      workspace.filePreviewRequestIds = { ...workspace.filePreviewRequestIds, [tab]: ++filePreviewRequestId };
      workspace.filePanels = {
        ...workspace.filePanels,
        [tab]: {
          kind: 'markdown',
          ...(request.documentId ? { documentId: request.documentId } : {}),
          ...(request.path ? { path: request.path } : {}),
          title,
          ...(subtitle ? { subtitle } : {}),
          content: request.content,
          state: 'idle',
          error: null,
        },
      };
      options.openTab(tab, agent.id);
      return;
    }

    workspace.planPanel = {
      kind: 'markdown',
      purpose: 'plan',
      title,
      ...(subtitle ? { subtitle } : {}),
      content: request.content,
      state: 'idle',
      error: null,
    };
    options.openTab('plan', agent.id);
  }

  function openGitDiff(request: Extract<SidePanelRequest, { kind: 'gitDiff' }>): void {
    if (request.scope === 'turn') return;
    const agentId = options.currentAgent()?.id;
    if (!agentId) return;
    const subtitle = localizedText(request.subtitle, translate);
    options.workspaceFor(agentId).gitReviewPanel = {
      kind: 'gitDiff',
      ...(request.target ? { target: request.target } : {}),
      ...(request.summary ? { summary: request.summary } : {}),
      title: localizedText(request.title, translate) ?? translate('surface.appShell.review'),
      ...(subtitle ? { subtitle } : {}),
      diff: request.diff,
      ...(request.sections ? { sections: request.sections } : {}),
      state: request.state ?? 'idle',
      error: request.error ?? null,
    };
    options.openTab('review', agentId);
  }

  function agentForId(agentId: string): Agent | undefined {
    return options.getSnapshot().agents.find((candidate) => candidate.id === agentId);
  }

  return {
    handleFileActivity,
    openAgentGitDiff,
    openConversationFile,
    openFile,
    openMarkdown,
    openSidePanel,
  };
}

export function fileBasename(filePath: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath;
}

function gitReviewPanel(
  folder: string,
  state: 'idle' | 'loading' | 'error',
  error: string | null,
  target?: import('@workspace/core/contracts').AgentGitDiffTarget,
): SidePanelGitDiffState {
  return {
    kind: 'gitDiff',
    ...(target ? { target } : {}),
    title: translate('surface.appShell.review'),
    subtitle: folder,
    diff: '',
    state,
    error,
  };
}


function filePreviewPanel(
  filePath: string,
  content: string,
  state: 'idle' | 'loading' | 'error',
  error: string | null,
): RightWorkspaceFilePanel {
  const kind = isMarkdownPath(filePath) ? 'markdown' : 'source';
  return {
    kind,
    title: fileBasename(filePath),
    subtitle: filePath,
    path: filePath,
    content,
    ...(kind === 'source' ? { language: languageForFilePath(filePath) ?? null } : {}),
    state,
    error,
  } as RightWorkspaceFilePanel;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMarkdownPath(filePath: string): boolean {
  const normalizedPath = filePath.split('#')[0]?.split('?')[0]?.toLowerCase() ?? '';
  return /\.(md|markdown|mdown|mkdn)$/u.test(normalizedPath);
}

function normalizePreviewFilePath(filePath: string, agentFolder?: string | null): string {
  const trimmedPath = filePath.trim();
  if (!trimmedPath.startsWith('file://')) {
    return toBackendPreviewPath(stripPreviewLineSuffix(trimmedPath), agentFolder);
  }
  try {
    return toBackendPreviewPath(stripPreviewLineSuffix(decodeURIComponent(new URL(trimmedPath).pathname)), agentFolder);
  } catch {
    return toBackendPreviewPath(stripPreviewLineSuffix(trimmedPath), agentFolder);
  }
}

function stripPreviewLineSuffix(filePath: string): string {
  return filePath.replace(/:(?:\d+)(?::\d+)?$/u, '');
}

function toBackendPreviewPath(filePath: string, agentFolder?: string | null): string {
  const normalizedPath = normalizePathSeparators(filePath);
  if (!isAbsolutePreviewPath(normalizedPath)) return normalizedPath;
  const normalizedFolder = normalizePathSeparators(agentFolder ?? '').replace(/\/+$/u, '');
  if (!normalizedFolder || !isAbsolutePreviewPath(normalizedFolder)) return normalizedPath;
  if (!normalizedPath.startsWith(`${normalizedFolder}/`)) return normalizedPath;
  return normalizedPath.slice(normalizedFolder.length + 1);
}

function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function isAbsolutePreviewPath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[a-z]:\//iu.test(filePath);
}
