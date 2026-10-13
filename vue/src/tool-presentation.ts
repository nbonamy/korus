import {
  provideCodexToolPresentation,
  type CodexToolPresentation,
  type CodexToolPresentationContext,
  type CodexToolVisibility,
  type CodexToolTitlePresenterContext,
} from '@codex-app-sdk/vue';
import {
  IconDeviceMobile as MobileIcon,
  IconBrowser as BrowserIcon,
  IconDeviceDesktop as DeviceDesktopIcon,
  IconGitBranch as GitBranchIcon,
  IconMarkdown as MarkdownIcon,
  IconMessage as MessageIcon,
  IconMessageReport as MessageReportIcon,
  IconSearch as SearchIcon,
  IconSquareCheck as SquareCheck,
  IconTargetArrow as TargetArrowIcon,
  IconSitemap as SitemapIcon,
  IconUsers as UsersIcon,
} from '@tabler/icons-vue';
import { presentClaudeToolTitle } from './claude-tool-titles';
import { appMcpToolName, appToolName, presentAppToolTitle } from './tool-title-presenter';

type Translate = CodexToolTitlePresenterContext['translate'];
type ToolIcon = Exclude<CodexToolPresentation['icon'], null | undefined>;
type AgentNameResolver = (identifier: string) => string | undefined;

// The linked SDK and App resolve Vue through separate package roots during
// typechecking, while Vite dedupes them at runtime. Keep that cast at this one
// host boundary instead of leaking it through the resolver.
const icons = {
  agents: UsersIcon as unknown as ToolIcon,
  simulator: MobileIcon as unknown as ToolIcon,
  browser: BrowserIcon as unknown as ToolIcon,
  computerUse: DeviceDesktopIcon as unknown as ToolIcon,
  markdown: MarkdownIcon as unknown as ToolIcon,
  messages: MessageIcon as unknown as ToolIcon,
  review: MessageReportIcon as unknown as ToolIcon,
  search: SearchIcon as unknown as ToolIcon,
  workItem: SquareCheck as unknown as ToolIcon,
  mission: TargetArrowIcon as unknown as ToolIcon,
  visualize: SitemapIcon as unknown as ToolIcon,
  workspace: GitBranchIcon as unknown as ToolIcon,
};

const BROWSER_TOOLS = new Set([
  'browser-click',
  'browser-console-logs',
  'browser-get-dom',
  'browser-open',
  'browser-set-viewport',
  'browser-screenshot',
  'browser-scroll',
  'browser-type',
]);
const COMPUTER_USE_TOOLS = new Set([
  'computer-use-click',
  'computer-use-dismiss',
  'computer-use-drag',
  'computer-use-find-apps',
  'computer-use-focus-app',
  'computer-use-get-app-state',
  'computer-use-guide',
  'computer-use-launch-app',
  'computer-use-list-apps',
  'computer-use-list-windows',
  'computer-use-paste',
  'computer-use-perform-secondary-action',
  'computer-use-press-key',
  'computer-use-request-accessibility',
  'computer-use-request-screen-recording',
  'computer-use-scroll',
  'computer-use-select-text',
  'computer-use-screenshot',
  'computer-use-set-value',
  'computer-use-status',
  'computer-use-stop',
  'computer-use-type-text',
]);
const MESSAGE_TOOLS = new Set(['broadcast-message', 'check-messages', 'send-message']);
const REVIEW_TOOLS = new Set(['start-automatic-review', 'mark-finding-complete', 'report-finding', 'update-finding', 'delete-finding', 'finish-review-round', 'report-mission-review-finding', 'update-mission-review-finding']);
const VISUALIZE_TOOLS = new Set(['suggest-visualizations', 'add-visualization', 'get-visualization', 'list-visualizations', 'delete-visualization', 'replace-visualization', 'read-visualization-canvas', 'edit-visualization-canvas', 'view-visualization-canvas']);
const AGENT_TOOLS = new Set(['create-agent', 'toggle-thread-flag', 'list-agents', 'register-agent']);
const TASK_TOOLS = new Set(['wait-tasks', 'complete-task', 'cancel-task']);
const WORKSPACE_TOOLS = new Set(['attach-mission-repository', 'create-automation', 'create-project', 'create-worktree', 'list-repos', 'list-worktrees']);
const HIDDEN_HOUSEKEEPING_TOOLS = new Set(['set-status', 'finish-turn']);

export const isAppToolVisible: CodexToolVisibility = (toolCall) =>
  !HIDDEN_HOUSEKEEPING_TOOLS.has(appToolName(toolCall.function, toolCall.kind, toolCall.metadata) ?? '');

export function presentAppTool(
  context: CodexToolPresentationContext,
  translate: Translate,
  resolveAgentName?: AgentNameResolver,
): CodexToolPresentation | undefined {
  if (context.descriptor?.action === 'search' && context.descriptor.params?.scope === 'tools') {
    const phase = context.descriptor.phase === 'failed' || context.toolCall.state === 'error'
      ? 'failed'
      : context.descriptor.phase === 'completed' ? 'completed' : 'running';
    return {
      icon: icons.search,
      title: translate(`chat.tool.searchTools.${phase}`),
    };
  }

  const claudeTitle = presentClaudeToolTitle(context, translate);
  if (claudeTitle) return { title: claudeTitle };

  if (context.kind === 'mcp' && context.metadata?.server === 'cua_repl' && context.metadata.tool === 'js') {
    const phase = context.descriptor?.phase === 'failed' || context.toolCall.state === 'error'
      ? 'failed'
      : context.descriptor?.phase === 'completed' || context.toolCall.state === 'completed'
        ? 'completed'
        : 'running';
    return { icon: icons.computerUse, title: translate(`chat.tool.mcp.cuaRepl.${phase}`) };
  }

  const tool = appMcpToolName(context.kind, context.metadata);
  const icon = tool ? appToolIcon(tool) : undefined;
  if (!icon) return undefined;

  const title = presentAppToolTitle({
    descriptor: context.descriptor,
    toolCall: context.toolCall,
    translate,
  }, resolveAgentName);
  return {
    icon,
    ...(title ? { title } : {}),
  };
}

export function provideAppToolPresentation(translate: Translate, resolveAgentName?: AgentNameResolver): void {
  provideCodexToolPresentation((context) => presentAppTool(context, translate, resolveAgentName));
}

function appToolIcon(tool: string): ToolIcon | undefined {
  if (tool === 'simulator') return icons.simulator;
  if (BROWSER_TOOLS.has(tool)) return icons.browser;
  if (COMPUTER_USE_TOOLS.has(tool)) return icons.computerUse;
  if (MESSAGE_TOOLS.has(tool)) return icons.messages;
  if (REVIEW_TOOLS.has(tool)) return icons.review;
  if (VISUALIZE_TOOLS.has(tool)) return icons.visualize;
  if (AGENT_TOOLS.has(tool)) return icons.agents;
  if (TASK_TOOLS.has(tool)) return icons.workItem;
  if (WORKSPACE_TOOLS.has(tool)) return icons.workspace;
  if (tool === 'read-skill' || tool === 'display-markdown' || tool === 'list-mission-artifacts' || tool === 'read-mission-artifact') return icons.markdown;
  if (tool === 'set-mission-title') return icons.mission;
  if (tool === 'update-work-item' || tool === 'write-mission-artifact' || tool === 'submit-mission-result' || tool === 'upsert-mission-ticket') return icons.workItem;
  return undefined;
}
