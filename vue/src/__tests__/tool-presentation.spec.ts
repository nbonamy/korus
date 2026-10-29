import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import type { CodexToolPresentationContext } from '@codex-app-sdk/vue';
import {
  IconBrowser as BrowserIcon,
  IconDeviceDesktop as DeviceDesktopIcon,
  IconGitBranch as GitBranchIcon,
  IconMarkdown as MarkdownIcon,
  IconMessage as MessageIcon,
  IconMessageReport as MessageReportIcon,
  IconSquareCheck as SquareCheck,
  IconTargetArrow as TargetArrowIcon,
  IconSitemap as SitemapIcon,
  IconUsers as UsersIcon,
  IconPhoto as PhotoIcon,
  IconWorld as WorldIcon,
} from '@tabler/icons-vue';
import { messages } from '../i18n/messages';
import { presentAppTool } from '../tool-presentation';

describe(`${product.name} tool presentation`, () => {
  it.each([
    ['running', 'browser screenshot', 'Searching tools'],
    ['completed', 'select:mcp__korus__list_agents', 'Searched tools'],
    ['failed', 'browser screenshot', 'Could not search tools'],
    ['running', undefined, 'Searching tools'],
    ['completed', undefined, 'Searched tools'],
  ])('shows a concise tool search label when %s', (phase, target, title) => {
    const call = context('ToolSearch', {});
    call.kind = 'generic';
    call.metadata = undefined;
    call.descriptor = { source: 'claude', action: 'search', phase, params: { scope: 'tools', target } };
    expect(presentAppTool(call, translate)?.title).toBe(title);
    call.descriptor.params = { target };
    expect(presentAppTool(call, translate)).toBeUndefined();
  });

  it.each([
    ['close-agent', UsersIcon, 'Closed agent'],
    ['generate-image', PhotoIcon, 'Generated images'],
    ['wait-tasks', SquareCheck, 'Checked delegated tasks'],
    ['complete-task', SquareCheck, 'Submitted task result'],
    ['cancel-task', SquareCheck, 'Requested task cancellation'],
    ['edit-visualization-canvas', SitemapIcon, 'Edited canvas'],
    ['add-visualization', SitemapIcon, 'Created diagram'],
    ['delete-visualization', SitemapIcon, 'Deleted diagram'],
    ['browser-screenshot', BrowserIcon, 'Captured page screenshot'],
    ['browser-set-viewport', BrowserIcon, 'Resized browser viewport'],
    ['computer-use-get-app-state', DeviceDesktopIcon, `Inspected ${product.name}`],
    ['computer-use-guide', DeviceDesktopIcon, 'Loaded Computer Use guide'],
    ['computer-use-list-windows', DeviceDesktopIcon, 'Listed Safari windows'],
    ['computer-use-dismiss', DeviceDesktopIcon, 'Dismissed native menu'],
    ['computer-use-press-key', DeviceDesktopIcon, 'Pressed Return in Safari'],
    ['computer-use-paste', DeviceDesktopIcon, 'Pasted content in Safari'],
    ['computer-use-select-text', DeviceDesktopIcon, 'Selected text in control #7 in Safari'],
    ['computer-use-drag', DeviceDesktopIcon, 'Dragged in Safari'],
    ['computer-use-perform-secondary-action', DeviceDesktopIcon, 'Performed secondary action on control #7 in Safari'],
    ['computer-use-screenshot', DeviceDesktopIcon, 'Captured main display screenshot'],
    ['computer-use-request-screen-recording', DeviceDesktopIcon, 'Requested macOS Screen Recording access for Computer Use'],
    ['send-message', MessageIcon, 'Sent message to codex-app-sdk'],
    ['report-finding', MessageReportIcon, 'Reported finding'],
    ['start_automatic_review', MessageReportIcon, 'Started automatic review'],
    ['delete-finding', MessageReportIcon, 'Deleted finding'],
    ['report-mission-review-finding', MessageReportIcon, 'Reported Mission finding'],
    ['list-agents', UsersIcon, 'Listed agents'],
    ['list-hosts', WorldIcon, 'Listed hosts'],
    ['toggle_thread_flag', UsersIcon, 'Updated thread flag'],
    ['create-worktree', GitBranchIcon, 'Created worktree feature/tool-icons'],
    ['create-project', GitBranchIcon, 'Created project new-product'],
    ['display-markdown', MarkdownIcon, 'Displayed Review notes'],
    ['read-skill', MarkdownIcon, 'Loaded skill'],
    ['reopen-mission-stage', TargetArrowIcon, 'Reopened mission stage'],
    ['set-mission-title', TargetArrowIcon, 'Named mission'],
    ['attach-mission-repository', GitBranchIcon, 'Attached mission repository'],
    ['get-mission-assignment', SquareCheck, 'Read mission assignment'],
    ['list-mission-artifacts', MarkdownIcon, 'Checked mission artifacts'],
    ['read-mission-artifact', MarkdownIcon, 'Read mission artifact'],
    ['write-mission-artifact', SquareCheck, 'Saved mission artifact'],
    ['submit-mission-result', SquareCheck, 'Mission artifact ready for review'],
    ['upsert-mission-ticket', SquareCheck, 'Drafted mission ticket'],
    ['update-work-item', SquareCheck, 'Updated work item'],
  ])(`presents %s with a semantic ${product.name} icon and title`, (tool, icon, title) => {
    const args = tool === 'send-message'
      ? { to: 'codex-app-sdk' }
      : tool === 'create-worktree'
        ? { branchName: 'feature/tool-icons' }
        : tool === 'create-project'
          ? { name: 'new-product' }
        : tool === 'display-markdown'
          ? { title: 'Review notes' }
          : tool === 'computer-use-get-app-state'
            ? { app: `${product.name}` }
            : tool === 'computer-use-list-windows'
              ? { app: 'Safari' }
              : tool === 'computer-use-press-key'
                ? { app: 'Safari', key: 'Return' }
              : tool === 'computer-use-paste' || tool === 'computer-use-drag'
                ? { app: 'Safari' }
                : tool === 'computer-use-select-text' || tool === 'computer-use-perform-secondary-action'
                  ? { app: 'Safari', element_index: 7 }
                  : tool === 'computer-use-screenshot'
                    ? { scope: 'screen' }
                    : {};

    expect(presentAppTool(context(tool, args), translate)).toStrictEqual({ icon, title });
  });

  it('normalizes underscored tool metadata from provider adapters', () => {
    expect(presentAppTool(context('computer_use_list_apps', {}), translate)).toStrictEqual({
      icon: DeviceDesktopIcon,
      title: 'Listed open apps',
    });
  });

  it('shows a fallback while the recipient streams in, then resolves its name', () => {
    const pending = context('send-message', undefined);
    pending.toolCall = { ...pending.toolCall, done: false, state: 'running' };
    expect(presentAppTool(pending, translate)).toStrictEqual({
      icon: MessageIcon, title: 'Sending message to other agent',
    });
    pending.toolCall = { ...pending.toolCall, args: { to: '   ' } };
    expect(presentAppTool(pending, translate)?.title).toBe('Sending message to other agent');
    const running = context('send-message', { to: 'agent-sdk' });
    running.toolCall = { ...running.toolCall, done: false, state: 'running' };

    expect(presentAppTool(
      running,
      translate,
      (identifier) => identifier === 'agent-sdk' ? 'codex-app-sdk' : undefined,
    )).toStrictEqual({
      icon: MessageIcon,
      title: 'Sending message to codex-app-sdk',
    });
  });

  it.each([
    ['running', 'Using Computer'],
    ['completed', 'Used Computer'],
    ['error', 'Could not use Computer'],
  ] as const)('presents cua_repl.js activity while %s', (state, title) => {
    const call = context('js', {}, 'cua_repl');
    call.toolCall = {
      ...call.toolCall,
      function: 'cua_repl.js',
      done: state !== 'running',
      state,
    };

    expect(presentAppTool(call, translate)).toStrictEqual({ icon: DeviceDesktopIcon, title });
  });

  it('leaves unknown, non-MCP, and third-party tools to the SDK fallback', () => {
    expect(presentAppTool(context('future-tool', {}), translate)).toBeUndefined();
    expect(presentAppTool(context('browser-open', {}, 'github'), translate)).toBeUndefined();
    expect(presentAppTool({ ...context('browser-open', {}), kind: 'generic' }, translate)).toBeUndefined();
  });

  it('recognizes the configured server namespace in Claude tool metadata', () => {
    expect(presentAppTool(context('report_finding', {}, product.mcpServerName), translate))
      .toStrictEqual({ icon: MessageReportIcon, title: 'Reported finding' });
  });
});

function context(
  tool: string,
  args: unknown,
  server = 'workspace',
): CodexToolPresentationContext {
  return {
    kind: 'mcp',
    metadata: { server, tool },
    toolCall: {
      args,
      done: true,
      function: `mcp__${server}__${tool.replaceAll('-', '_')}`,
      id: 'tool-1',
      kind: 'mcp',
      metadata: { server, tool },
      result: undefined,
      state: 'completed',
    },
  };
}

function translate(key: string, params?: Record<string, unknown>): string {
  const value = key.split('.').reduce<unknown>((current, segment) => (
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), messages.en);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')).trim();
}
