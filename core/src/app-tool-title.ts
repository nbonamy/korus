import { computerUseTitle } from './computer-use-title';

/** The row Korus shows for one of its own MCP tool calls, built here so a harness only displays the final string. English only. */
export type AppToolPhase = 'completed' | 'failed' | 'running';
export type AppAgentNameResolver = (identifier: string) => string | undefined;

const SIMULATOR_ACTIONS = new Set([
  'list', 'status', 'attach', 'detach', 'shutdown', 'screenshot',
  'inspect', 'tap', 'swipe', 'text', 'button', 'launch',
]);

const TOOL_KEYS: Record<string, string> = {
  'restart-backend': 'restartBackend',
  'open-design': 'openDesign',
  'generate-image': 'generateImage',
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
  'create-agent': 'createAgent',
  'close-agent': 'closeAgent',
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
  'list-hosts': 'listHosts',
  'list-repos': 'listRepos',
  'list-worktrees': 'listWorktrees',
  'set-mission-title': 'setMissionTitle',
  'reopen-mission-stage': 'reopenMissionStage',
  'set-mission-execution-policy': 'setMissionExecutionPolicy',
  'attach-mission-repository': 'attachMissionRepository',
  'list-mission-artifacts': 'listMissionArtifacts',
  'read-mission-artifact': 'readMissionArtifact',
  'write-mission-artifact': 'writeMissionArtifact',
  'get-mission-assignment': 'getMissionAssignment',
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

const STRINGS = {
  restartBackend: { running: 'Requesting backend restart', completed: 'Requested backend restart', failed: 'Could not request backend restart' },
  broadcastMessage: {
    completed: 'Broadcast message',
    failed: 'Failed broadcasting message',
    running: 'Broadcasting message',
  },
  simulator: {
    running: 'Using simulator', completed: 'Used simulator', failed: 'Simulator action failed',
    device: 'simulator',
    list: { running: 'Listing simulators', completed: 'Listed simulators', failed: 'Could not list simulators' },
    status: { running: 'Checking simulator status', completed: 'Checked simulator status', failed: 'Could not check simulator status' },
    attach: { running: 'Opening {target}', completed: 'Opened {target}', failed: 'Could not open {target}' },
    detach: { running: 'Detaching simulator', completed: 'Detached simulator', failed: 'Could not detach simulator' },
    shutdown: { running: 'Shutting down simulator', completed: 'Shut down simulator', failed: 'Could not shut down simulator' },
    screenshot: { running: 'Capturing simulator screenshot', completed: 'Captured simulator screenshot', failed: 'Could not capture simulator screenshot' },
    inspect: { running: 'Inspecting simulator screen', completed: 'Inspected simulator screen', failed: 'Could not inspect simulator screen' },
    tap: { running: 'Tapping simulator screen', completed: 'Tapped simulator screen', failed: 'Could not tap simulator screen' },
    swipe: { running: 'Swiping simulator screen', completed: 'Swiped simulator screen', failed: 'Could not swipe simulator screen' },
    text: { running: 'Typing in simulator', completed: 'Typed in simulator', failed: 'Could not type in simulator' },
    button: { running: 'Pressing simulator button', completed: 'Pressed simulator button', failed: 'Could not press simulator button' },
    launch: { running: 'Launching simulator app', completed: 'Launched simulator app', failed: 'Could not launch simulator app' },
  },
  browserClick: {
    completed: 'Clicked page',
    failed: 'Failed clicking page',
    running: 'Clicking page',
  },
  browserConsoleLogs: {
    completed: 'Read browser console',
    failed: 'Failed reading browser console',
    running: 'Reading browser console',
  },
  browserGetDom: {
    completed: 'Inspected page',
    failed: 'Failed inspecting page',
    running: 'Inspecting page',
  },
  browserOpen: {
    completed: 'Opened {target}',
    failed: 'Failed opening {target}',
    running: 'Opening {target}',
  },
  browserSetViewport: {
    running: 'Resizing browser viewport',
    completed: 'Resized browser viewport',
    failed: 'Failed resizing browser viewport',
  },
  browserScreenshot: {
    completed: 'Captured page screenshot',
    failed: 'Failed capturing page screenshot',
    running: 'Capturing page screenshot',
  },
  browserScroll: {
    completed: 'Scrolled page',
    failed: 'Failed scrolling page',
    running: 'Scrolling page',
  },
  browserType: {
    completed: 'Entered text on page',
    failed: 'Failed entering text on page',
    running: 'Entering text on page',
  },
  checkMessages: {
    completed: 'Checked messages',
    failed: 'Failed checking messages',
    running: 'Checking messages',
  },
  displayMarkdown: {
    completed: 'Displayed {target}',
    failed: 'Failed displaying {target}',
    running: 'Displaying {target}',
  },
  readSkill: {
    completed: 'Loaded skill {target}',
    failed: 'Could not load skill {target}',
    running: 'Loading skill {target}',
  },
  publishHtmlPlan: {
    completed: 'Published interactive plan',
    failed: 'Could not publish interactive plan',
    running: 'Publishing interactive plan',
  },
  readHtmlPlan: {
    completed: 'Read interactive plan',
    failed: 'Could not read interactive plan',
    running: 'Reading interactive plan',
  },
  createAgent: {
    completed: 'Created agent {target}',
    failed: 'Failed creating agent {target}',
    running: 'Creating agent {target}',
  },
  generateImage: {
    completed: 'Generated images',
    failed: 'Could not generate images',
    running: 'Generating images',
  },
  closeAgent: {
    completed: 'Closed agent',
    failed: 'Could not close agent',
    running: 'Closing agent',
  },
  waitTasks: {
    running: 'Waiting for delegated tasks',
    completed: 'Checked delegated tasks',
    failed: 'Could not check delegated tasks',
  },
  completeTask: {
    running: 'Submitting task result',
    completed: 'Submitted task result',
    failed: 'Could not submit task result',
  },
  cancelTask: {
    running: 'Cancelling delegated task',
    completed: 'Requested task cancellation',
    failed: 'Could not cancel delegated task',
  },
  createProject: {
    completed: 'Created project {target}',
    failed: 'Failed creating project {target}',
    running: 'Creating project {target}',
  },
  createAutomation: {
    completed: 'Created automation {target}',
    failed: 'Failed creating automation {target}',
    running: 'Creating automation {target}',
  },
  createWorktree: {
    completed: 'Created worktree {target}',
    failed: 'Failed creating worktree {target}',
    running: 'Creating worktree {target}',
  },
  listAgents: {
    completed: 'Listed agents',
    failed: 'Failed listing agents',
    running: 'Listing agents',
  },
  listHosts: {
    completed: 'Listed hosts',
    failed: 'Failed listing hosts',
    running: 'Listing hosts',
  },
  listRepos: {
    completed: 'Listed repositories',
    failed: 'Failed listing repositories',
    running: 'Listing repositories',
  },
  listWorktrees: {
    completed: 'Listed worktrees for {target}',
    failed: 'Failed listing worktrees for {target}',
    running: 'Listing worktrees for {target}',
  },
  reopenMissionStage: { running: 'Reopening mission stage', completed: 'Reopened mission stage', failed: 'Could not reopen mission stage' },
  setMissionTitle: { running: 'Naming mission', completed: 'Named mission', failed: 'Could not name mission' },
  openDesign: { running: 'Opening Design', completed: 'Opened Design', failed: 'Could not open Design' },
  suggestVisualizations: { running: 'Suggesting diagrams', completed: 'Suggested diagrams', failed: 'Could not suggest diagrams' },
  addVisualization: { running: 'Creating diagram', completed: 'Created diagram', failed: 'Could not create diagram' },
  readVisualizationCanvas: { running: 'Reading canvas selection', completed: 'Read canvas selection', failed: 'Could not read canvas selection' },
  editVisualizationCanvas: { running: 'Editing canvas', completed: 'Edited canvas', failed: 'Could not edit canvas' },
  viewVisualizationCanvas: { running: 'Viewing canvas', completed: 'Viewed canvas', failed: 'Could not view canvas' },
  getVisualization: { running: 'Reading diagram', completed: 'Read diagram', failed: 'Could not read diagram' },
  listVisualizations: { running: 'Listing diagrams', completed: 'Listed diagrams', failed: 'Could not list diagrams' },
  deleteVisualization: { running: 'Deleting diagram', completed: 'Deleted diagram', failed: 'Could not delete diagram' },
  replaceVisualization: { running: 'Updating diagram', completed: 'Updated diagram', failed: 'Could not update diagram' },
  setMissionExecutionPolicy: { running: 'Setting implementation review', completed: 'Set implementation review', failed: 'Could not set implementation review' },
  attachMissionRepository: { running: 'Attaching mission repository', completed: 'Attached mission repository', failed: 'Could not attach mission repository' },
  listMissionArtifacts: { running: 'Checking mission artifacts', completed: 'Checked mission artifacts', failed: 'Could not check mission artifacts' },
  readMissionArtifact: { running: 'Reading mission artifact', completed: 'Read mission artifact', failed: 'Could not read mission artifact' },
  writeMissionArtifact: { running: 'Saving mission artifact', completed: 'Saved mission artifact', failed: 'Could not save mission artifact' },
  getMissionAssignment: { running: 'Reading mission assignment', completed: 'Read mission assignment', failed: 'Could not read mission assignment' },
  submitMissionResult: { running: 'Submitting mission artifact', completed: 'Mission artifact ready for review', failed: 'Could not submit mission artifact' },
  upsertMissionTicket: { running: 'Drafting mission ticket', completed: 'Drafted mission ticket', failed: 'Could not draft mission ticket' },
  reportMissionReviewFinding: { running: 'Reporting Mission finding', completed: 'Reported Mission finding', failed: 'Could not report Mission finding' },
  updateMissionReviewFinding: { running: 'Updating Mission finding', completed: 'Updated Mission finding', failed: 'Could not update Mission finding' },
  markFindingComplete: {
    completed: 'Verified finding fix',
    failed: 'Failed verifying finding fix',
    running: 'Verifying finding fix',
  },
  reportFinding: {
    completed: 'Reported finding',
    failed: 'Failed reporting finding',
    running: 'Reporting finding',
  },
  finishReviewRound: {
    completed: 'Review round finished',
    failed: 'Could not finish review round',
    running: 'Finishing review round',
  },
  startAutomaticReview: {
    completed: 'Started automatic review',
    failed: 'Could not start automatic review',
    running: 'Starting automatic review',
  },
  deleteFinding: {
    completed: 'Deleted finding',
    failed: 'Could not delete finding',
    running: 'Deleting finding',
  },
  updateWorkItem: {
    completed: 'Updated work item',
    failed: 'Failed updating work item',
    running: 'Updating work item',
  },
  registerAgent: {
    completed: 'Registered agent',
    failed: 'Failed registering agent',
    running: 'Registering agent',
  },
  sendMessage: {
    otherAgent: 'other agent',
    completed: 'Sent message to {target}',
    failed: 'Failed sending message to {target}',
    running: 'Sending message to {target}',
  },
  toggleThreadFlag: {
    completed: 'Updated thread flag',
    failed: 'Failed updating thread flag',
    running: 'Updating thread flag',
  },
  updateFinding: {
    completed: 'Updated finding',
    failed: 'Failed updating finding',
    running: 'Updating finding',
  },
};

/** The title of a Korus MCP tool call (`tool` is its name with dashes), or undefined for a tool this does not know. */
export function appToolTitle({ tool, args, result, phase, resolveAgentName }: {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  phase: AppToolPhase;
  resolveAgentName?: AppAgentNameResolver;
}): string | undefined {
  if (tool.startsWith('computer-use-')) return computerUseTitle(tool, args, result, phase);
  const simulatorAction = tool === 'simulator' && typeof args.action === 'string' && SIMULATOR_ACTIONS.has(args.action)
    ? args.action : undefined;
  const key = simulatorAction ? `simulator.${simulatorAction}` : TOOL_KEYS[tool];
  if (!key) return undefined;

  const target = simulatorAction === 'attach'
    ? (phase === 'completed' ? simulatorDeviceName(result) : undefined) ?? phrase('simulator.device')
    : toolTarget(tool, args, result, phase, resolveAgentName) || (tool === 'send-message' ? phrase('sendMessage.otherAgent') : '');
  return phrase(`${key}.${phase}`)?.replace('{target}', () => target ?? '').replace(/\s{2,}/g, ' ').trim();
}

function phrase(path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((node, key) => isRecord(node) ? node[key] : undefined, STRINGS);
  return typeof value === 'string' ? value : undefined;
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

function toolTarget(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  phase: AppToolPhase,
  resolveAgentName?: AppAgentNameResolver,
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
                : [];

  const target = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return target?.trim() ?? '';
}

function nestedResultRecords(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return [];
  const records = [result];
  for (const key of ['structuredContent', 'result']) {
    if (isRecord(result[key])) records.push(result[key]);
  }
  return records;
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return value?.trim();
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
