import { isAppMcpServerName } from '@workspace/core/product';
import {
  type CodexToolTitlePresenterContext,
} from '@codex-app-sdk/vue';

type ToolPhase = 'completed' | 'failed' | 'running';
type AgentNameResolver = (identifier: string) => string | undefined;

const SIMULATOR_ACTIONS = new Set([
  'list', 'status', 'attach', 'detach', 'shutdown', 'screenshot',
  'inspect', 'tap', 'swipe', 'text', 'button', 'launch',
]);

const TOOL_KEYS: Record<string, string> = {
  simulator: 'simulator',
  'read-skill': 'readSkill',
  'wait-tasks': 'waitTasks',
  'complete-task': 'completeTask',
  'cancel-task': 'cancelTask',
  'broadcast-message': 'broadcastMessage',
  'browser-click': 'browserClick',
  'browser-console-logs': 'browserConsoleLogs',
  'browser-get-dom': 'browserGetDom',
  'browser-open': 'browserOpen',
  'browser-set-viewport': 'browserSetViewport',
  'browser-screenshot': 'browserScreenshot',
  'browser-scroll': 'browserScroll',
  'browser-type': 'browserType',
  'check-messages': 'checkMessages',
  'computer-use-click': 'computerUseClick',
  'computer-use-dismiss': 'computerUseDismiss',
  'computer-use-drag': 'computerUseDrag',
  'computer-use-find-apps': 'computerUseFindApps',
  'computer-use-focus-app': 'computerUseFocusApp',
  'computer-use-get-app-state': 'computerUseGetAppState',
  'computer-use-guide': 'computerUseGuide',
  'computer-use-launch-app': 'computerUseLaunchApp',
  'computer-use-list-apps': 'computerUseListApps',
  'computer-use-list-windows': 'computerUseListWindows',
  'computer-use-paste': 'computerUsePaste',
  'computer-use-perform-secondary-action': 'computerUsePerformSecondaryAction',
  'computer-use-press-key': 'computerUsePressKey',
  'computer-use-request-accessibility': 'computerUseRequestAccessibility',
  'computer-use-request-screen-recording': 'computerUseRequestScreenRecording',
  'computer-use-scroll': 'computerUseScroll',
  'computer-use-select-text': 'computerUseSelectText',
  'computer-use-screenshot': 'computerUseScreenshot',
  'computer-use-set-value': 'computerUseSetValue',
  'computer-use-status': 'computerUseStatus',
  'computer-use-stop': 'computerUseStop',
  'computer-use-type-text': 'computerUseTypeText',
  'create-agent': 'createAgent',
  'create-automation': 'createAutomation',
  'create-project': 'createProject',
  'create-worktree': 'createWorktree',
  'display-markdown': 'displayMarkdown',
  'delete-finding': 'deleteFinding',
  'finish-review-round': 'finishReviewRound',
  'start-automatic-review': 'startAutomaticReview',
  'suggest-visualizations': 'suggestVisualizations',
  'add-visualization': 'addVisualization',
  'read-visualization-canvas': 'readVisualizationCanvas',
  'edit-visualization-canvas': 'editVisualizationCanvas',
  'view-visualization-canvas': 'viewVisualizationCanvas',
  'get-visualization': 'getVisualization',
  'list-visualizations': 'listVisualizations',
  'delete-visualization': 'deleteVisualization',
  'replace-visualization': 'replaceVisualization',
  'list-agents': 'listAgents',
  'list-repos': 'listRepos',
  'list-worktrees': 'listWorktrees',
  'set-mission-title': 'setMissionTitle',
  'set-mission-execution-policy': 'setMissionExecutionPolicy',
  'attach-mission-repository': 'attachMissionRepository',
  'list-mission-artifacts': 'listMissionArtifacts',
  'read-mission-artifact': 'readMissionArtifact',
  'write-mission-artifact': 'writeMissionArtifact',
  'submit-mission-result': 'submitMissionResult',
  'upsert-mission-ticket': 'upsertMissionTicket',
  'report-mission-review-finding': 'reportMissionReviewFinding',
  'update-mission-review-finding': 'updateMissionReviewFinding',
  'mark-finding-complete': 'markFindingComplete',
  'report-finding': 'reportFinding',
  'update-work-item': 'updateWorkItem',
  'register-agent': 'registerAgent',
  'send-message': 'sendMessage',
  // Retained so older conversations keep a useful title after the tool rename.
  'toggle-thread-flag': 'toggleThreadFlag',
  'update-finding': 'updateFinding',
};

export function presentAppToolTitle({
  descriptor,
  toolCall,
  translate,
}: CodexToolTitlePresenterContext, resolveAgentName?: AgentNameResolver): string | undefined {
  const tool = appToolName(toolCall.function, toolCall.kind, toolCall.metadata, descriptor?.params?.tool);
  if (!tool) return undefined;

  const args = isRecord(toolCall.args) ? toolCall.args : {};
  const simulatorAction = tool === 'simulator' && typeof args.action === 'string' && SIMULATOR_ACTIONS.has(args.action)
    ? args.action : undefined;
  const key = simulatorAction ? `simulator.${simulatorAction}` : TOOL_KEYS[tool];
  if (!key) return undefined;

  const phase = toolPhase(descriptor?.phase, toolCall.state);
  return translate(`chat.tool.mcp.app.${key}.${phase}`, {
    target: simulatorAction === 'attach'
      ? (phase === 'completed' ? simulatorDeviceName(toolCall.result) : undefined) ?? translate('chat.tool.mcp.app.simulator.device')
      : toolTarget(tool, args, toolCall.result, phase, resolveAgentName),
  });
}

function simulatorDeviceName(result: unknown): string | undefined {
  for (const payload of nestedResultRecords(result)) {
    const attachment = isRecord(payload.attachment) ? payload.attachment : undefined;
    const device = attachment && isRecord(attachment.device) ? attachment.device : undefined;
    const name = device && firstString(device.name);
    if (name) return name;
  }
  return undefined;
}

export function appToolName(
  functionName: string,
  kind?: string,
  metadata?: Readonly<Record<string, unknown>>,
  descriptorTool?: unknown,
): string | undefined {
  const metadataTool = appMcpToolName(kind, metadata);
  if (metadataTool) return metadataTool;

  const rawName = typeof descriptorTool === 'string' ? descriptorTool : functionName;
  const match = /^mcp__(.+?)__(.+)$/.exec(rawName) ?? /^([^._]+)[._](.+)$/.exec(rawName);
  const toolName = match && isAppMcpServerName(match[1]) ? match[2] : undefined;
  if (!toolName) return undefined;

  return toolName.replaceAll('_', '-');
}

export function appMcpToolName(
  kind?: string,
  metadata?: Readonly<Record<string, unknown>>,
): string | undefined {
  if (kind !== 'mcp' || !isAppMcpServerName(metadata?.server) || typeof metadata?.tool !== 'string') {
    return undefined;
  }
  const tool = metadata.tool.trim().replaceAll('_', '-');
  return tool || undefined;
}

function toolPhase(descriptorPhase: string | undefined, state: string): ToolPhase {
  if (descriptorPhase === 'failed' || state === 'error') return 'failed';
  if (descriptorPhase === 'completed' || state === 'completed') return 'completed';
  return 'running';
}

function toolTarget(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  phase: ToolPhase,
  resolveAgentName?: AgentNameResolver,
): string {
  const requestedRecipient = typeof args.to === 'string' ? args.to.trim() : '';
  const candidates = tool === 'send-message'
    ? [
        phase === 'completed' ? resultString(result, 'recipientName') : undefined,
        requestedRecipient ? resolveAgentName?.(requestedRecipient) : undefined,
        requestedRecipient,
      ]
    : tool === 'browser-open'
      ? [args.url]
      : tool === 'display-markdown'
        ? [args.title, args.path]
        : tool === 'create-agent'
            ? [phase === 'completed' ? resultString(result, 'agentName') : undefined, args.name, args.branchName, args.repoPath]
            : tool === 'create-project' || tool === 'create-automation' || tool === 'read-skill'
              ? [args.name]
              : tool === 'create-worktree'
              ? [args.branchName, args.destinationPath]
              : tool === 'list-worktrees'
                ? [args.repoPath]
                : tool.startsWith('computer-use-')
                  ? [computerUseTarget(tool, args, result)]
                  : [];

  const target = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return target?.trim() ?? '';
}

function computerUseTarget(tool: string, args: Record<string, unknown>, result: unknown): string {
  const app = computerUseAppTarget(args, result);
  const elementIndex = integer(args.element_index);
  const rootElementIndex = integer(args.rootElementIndex);
  const x = finiteNumber(args.x);
  const y = finiteNumber(args.y);

  switch (tool) {
    case 'computer-use-click':
      if (elementIndex !== undefined) return `control #${elementIndex} in ${app}`;
      if (x !== undefined && y !== undefined) return `${app} at (${x}, ${y})`;
      return `app control in ${app}`;
    case 'computer-use-find-apps':
      return hasExplicitAppTarget(args) ? `installed apps matching ${app}` : 'installed apps';
    case 'computer-use-focus-app':
    case 'computer-use-launch-app':
      return app;
    case 'computer-use-get-app-state':
      return rootElementIndex === undefined ? app : `control #${rootElementIndex} in ${app}`;
    case 'computer-use-list-apps': {
      const count = resultArrayLength(result, 'apps');
      return count === undefined ? 'open apps' : `${count} open apps`;
    }
    case 'computer-use-list-windows': {
      const count = resultArrayLength(result, 'windows');
      return count === undefined ? `${app} windows` : `${count} ${app} windows`;
    }
    case 'computer-use-scroll': {
      const direction = firstString(args.direction);
      return elementIndex === undefined
        ? `${direction ?? ''}${direction ? ' in ' : ''}${app}`
        : `control #${elementIndex}${direction ? ` ${direction}` : ''} in ${app}`;
    }
    case 'computer-use-screenshot': {
      if (args.scope === 'screen') {
        const displayId = integer(args.displayId);
        return `${displayId === undefined ? 'main display' : `display ${displayId}`} screenshot`;
      }
      return `${app} window screenshot`;
    }
    case 'computer-use-set-value':
    case 'computer-use-select-text':
    case 'computer-use-perform-secondary-action':
      return elementIndex === undefined ? `app control in ${app}` : `control #${elementIndex} in ${app}`;
    case 'computer-use-press-key': {
      const key = firstString(args.key);
      return key ? `${key} in ${app}` : app;
    }
    case 'computer-use-drag':
    case 'computer-use-paste':
    case 'computer-use-type-text':
      return app;
    default:
      return app;
  }
}

function computerUseAppTarget(args: Record<string, unknown>, result: unknown): string {
  return resultAppName(result) ??
    firstString(args.app, args.name, args.appName) ??
    appNameFromPath(firstString(args.path)) ??
    firstString(args.bundleIdentifier) ??
    (integer(args.pid) === undefined ? 'frontmost app' : 'target app');
}

function resultAppName(result: unknown): string | undefined {
  const payloads = nestedResultRecords(result);
  for (const payload of payloads) {
    const app = isRecord(payload.app) ? payload.app : undefined;
    const name = app ? firstString(app.localizedName, app.name) : undefined;
    if (name) return name;
  }
  return undefined;
}

function resultArrayLength(result: unknown, key: string): number | undefined {
  for (const payload of nestedResultRecords(result)) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  return undefined;
}

function nestedResultRecords(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return [];
  const records = [result];
  for (const key of ['structuredContent', 'result']) {
    if (isRecord(result[key])) records.push(result[key]);
  }
  return records;
}

function hasExplicitAppTarget(args: Record<string, unknown>): boolean {
  return firstString(args.app, args.name, args.appName, args.bundleIdentifier, args.path) !== undefined;
}

function appNameFromPath(value: string | undefined): string | undefined {
  const name = value?.split('/').filter(Boolean).at(-1)?.replace(/\.app$/u, '').trim();
  return name || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return value?.trim();
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resultString(result: unknown, key: string): string | undefined {
  for (const payload of nestedResultRecords(result)) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
