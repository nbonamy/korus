import { executionSelectionOverridesSchema } from '../execution-selection-schema';
import type { ExecutionSelectionOverrides } from '@workspace/core/contracts/execution';
import type { MissionArtifactReadResult, MissionArtifactWriteInput, MissionResultInput, MissionReviewFindingInput, MissionReviewFindingUpdateInput, MissionTicketDraftInput, MissionTicketDraftResult, MissionToolContext } from '@workspace/core/mission-execution';
import type { MissionArtifactFile, MissionStage } from '@workspace/core/missions';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentBackend, AgentStatus, AnnouncementPhase, CelebrationKind, CreateSourceWorktreeInput, SourceRepository, SourceWorktree, WorkBacklogAssignmentStatus } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import type { ThreadFlagId } from '@workspace/core/thread-flags';
import type { DelegatedTask, TaskContract } from '@workspace/core/delegated-task';

export type McpAgentInfo = {
  id: string;
  name: string;
  folder: string | null;
  status: string;
};

export type McpMessage = {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
};

export type MessageInfo = {
  id: string;
  from: string;
  fromId: string;
  content: string;
  timestamp: string;
};

export type ListAgentsResponse = {
  agents: McpAgentInfo[];
};

export type SendMessageResponse = {
  success: boolean;
  message: string;
  recipientId: string;
  recipientName: string;
};

export type CheckMessagesResponse = {
  messages: MessageInfo[];
};

export type BroadcastResponse = {
  success: boolean;
  recipientCount: number;
};

export type DisplayMarkdownInput = {
  markdown?: string;
  path?: string;
  title?: string;
};

export type DisplayMarkdownResponse = {
  success: true;
  message: string;
  path?: string;
  title?: string;
};

export type CelebrationResponse = {
  success: true;
  requested: boolean;
  kind: CelebrationKind;
  message: string;
};

export type AnnouncementResponse = {
  success: true;
  phase: AnnouncementPhase;
};

export type StatusAnnouncementInput = {
  phase: AnnouncementPhase;
  text: string;
};

export type SetStatusResponse = {
  success: true;
  status: string | null;
  announcement?: AnnouncementResponse;
};

export type FinishTurnResponse = {
  success: true;
  status: null;
  flag?: ThreadFlagId;
  announcement?: AnnouncementResponse;
  celebration?: CelebrationResponse;
};

export type FinishTurnInput = {
  flag?: ThreadFlagId;
  suggestedPrompt?: string;
  announcement?: { text: string };
  celebration?: boolean;
};

export type UpdateWorkItemResponse =
  | {
    success: true;
    workItemId: string;
    status: 'completion-instructions-required';
    instructions: string;
    message: string;
    repeatUpdateRequired: true;
  }
  | {
    success: true;
    workItemId: string;
    status: WorkBacklogAssignmentStatus;
    updatedAt: string;
    note?: string;
  };

export type McpCreateAgentInput = {
  goal?: boolean;
  requestId?: string;
  task?: TaskContract;
  selection?: ExecutionSelectionOverrides;
  branchName?: string;
  createWorktree?: boolean;
  destinationPath?: string;
  name?: string;
  prompt?: string;
  instructions?: string;
  startingContext?: import('@workspace/core/delegation-context').DelegationStartingContext;
  repoPath: string;
};

export type McpCreateAgentResponse = {
  taskId?: string;
  task?: DelegatedTask;
  success: boolean;
  agentId?: string;
  agentName?: string;
  branchName?: string;
  folder?: string;
  promptSubmitted?: boolean;
  delegationContext?: import('@workspace/core/delegation-context').DelegationContext;
  message: string;
};

export type MissionToolPort = {
  acquireCommitLock?(agentId: string, signal?: AbortSignal): Promise<{ acquired: boolean }>;
  releaseCommitLock?(agentId: string): Promise<{ released: true }>;
  contextForAgent(agentId: string): MissionToolContext | undefined;
  submitResult(agentId: string, input: MissionResultInput): Promise<{ success: true; status: 'awaitingReview' | 'accepted' }>;
  upsertTicket(agentId: string, input: MissionTicketDraftInput): Promise<MissionTicketDraftResult>;
  setTitle(agentId: string, title: string): Promise<{ success: true; title: string }>;
  attachRepository(agentId: string, repoPath: string): Promise<{ success: true; repoPath: string }>;
  listArtifacts(agentId: string): Array<{ stage: MissionStage } & MissionArtifactFile>;
  readArtifact(agentId: string, stage: MissionStage): Promise<MissionArtifactReadResult>;
  writeArtifact(agentId: string, input: MissionArtifactWriteInput): Promise<MissionArtifactReadResult>;
  reportReviewFinding(agentId: string, input: MissionReviewFindingInput): Promise<unknown>;
  updateReviewFinding(agentId: string, input: MissionReviewFindingUpdateInput): Promise<unknown>;
};

export type AppMcpAgentCoordinatorOptions = {
  missionTools?: MissionToolPort;
  getAgents: () => Agent[];
  onAgentUpdated?: (agent: Agent) => void;
  onInboxMessage?: (agentId: string, messageId: string) => void;
  onDisplayMarkdown?: (agent: Agent, input: DisplayMarkdownInput) => DisplayMarkdownResponse | Promise<DisplayMarkdownResponse>;
  onCelebrate?: (agent: Agent) => CelebrationResponse | Promise<CelebrationResponse>;
  onAnnounce?: (agent: Agent, phase: AnnouncementPhase, text: string) => AnnouncementResponse | Promise<AnnouncementResponse>;
  onUpdateWorkItem?: (agent: Agent, workItemId: string, status: WorkBacklogAssignmentStatus, note?: string) => UpdateWorkItemResponse | Promise<UpdateWorkItemResponse>;
  onListSourceRepositories?: () => SourceRepository[] | Promise<SourceRepository[]>;
  onListSourceWorktrees?: (repoPath: string) => SourceWorktree[] | Promise<SourceWorktree[]>;
  onCreateSourceWorktree?: (input: CreateSourceWorktreeInput) => SourceWorktree | Promise<SourceWorktree>;
  onCreateAgent?: (agent: Agent, input: McpCreateAgentInput & { teamId?: string }) => McpCreateAgentResponse | Promise<McpCreateAgentResponse>;
  onCloseAgent?: (callerAgentId: string, agentId: string) => Promise<void>;
  createId?: () => string;
  now?: () => Date;
};

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

export class AppMcpAgentCoordinator {
  private readonly missionTools?: MissionToolPort;
  private readonly messages: McpMessage[] = [];
  private readonly getAgents: () => Agent[];
  private readonly onAgentUpdated?: (agent: Agent) => void;
  private readonly onInboxMessage?: (agentId: string, messageId: string) => void;
  private readonly onDisplayMarkdown?: (agent: Agent, input: DisplayMarkdownInput) => DisplayMarkdownResponse | Promise<DisplayMarkdownResponse>;
  private readonly onCelebrate?: (agent: Agent) => CelebrationResponse | Promise<CelebrationResponse>;
  private readonly onAnnounce?: (agent: Agent, phase: AnnouncementPhase, text: string) => AnnouncementResponse | Promise<AnnouncementResponse>;
  private readonly onUpdateWorkItem?: (agent: Agent, workItemId: string, status: WorkBacklogAssignmentStatus, note?: string) => UpdateWorkItemResponse | Promise<UpdateWorkItemResponse>;
  private readonly onListSourceRepositories?: () => SourceRepository[] | Promise<SourceRepository[]>;
  private readonly onListSourceWorktrees?: (repoPath: string) => SourceWorktree[] | Promise<SourceWorktree[]>;
  private readonly onCreateSourceWorktree?: (input: CreateSourceWorktreeInput) => SourceWorktree | Promise<SourceWorktree>;
  private readonly onCreateAgent?: (agent: Agent, input: McpCreateAgentInput & { teamId?: string }) => McpCreateAgentResponse | Promise<McpCreateAgentResponse>;
  private readonly onCloseAgent?: AppMcpAgentCoordinatorOptions['onCloseAgent'];
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: AppMcpAgentCoordinatorOptions) {
    this.missionTools = options.missionTools;
    this.getAgents = options.getAgents;
    this.onAgentUpdated = options.onAgentUpdated;
    this.onInboxMessage = options.onInboxMessage;
    this.onDisplayMarkdown = options.onDisplayMarkdown;
    this.onCelebrate = options.onCelebrate;
    this.onAnnounce = options.onAnnounce;
    this.onUpdateWorkItem = options.onUpdateWorkItem;
    this.onListSourceRepositories = options.onListSourceRepositories;
    this.onListSourceWorktrees = options.onListSourceWorktrees;
    this.onCreateSourceWorktree = options.onCreateSourceWorktree;
    this.onCreateAgent = options.onCreateAgent;
    this.onCloseAgent = options.onCloseAgent;
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  connectAgent(agentId: string, sessionId?: string): Agent {
    const agent = this.requireAgent(agentId);
    const updatedAt = this.now().toISOString();
    agent.isRegistered = true;
    agent.mcpSessionId = sessionId;
    agent.updatedAt = updatedAt;
    this.onAgentUpdated?.(agent);

    return agent;
  }

  listAgents(callerAgentId: string): ListAgentsResponse {
    const caller = this.requireAgent(callerAgentId);

    return {
      agents: this.listVisibleAgents(caller),
    };
  }

  sendMessage(from: string, to: string, content: string): SendMessageResponse {
    const sender = this.requireAgent(from);
    const recipient = this.findAgentInSameTeam(sender, to);
    if (!recipient) {
      throw new McpToolError('Failed to send message: Recipient not found');
    }

    const message = this.storeMessage(sender.id, recipient.id, content);
    this.onInboxMessage?.(recipient.id, message.id);

    return {
      success: true,
      message: 'Message sent successfully. The recipient will process it when they are idle.',
      recipientId: recipient.id,
      recipientName: agentDisplayName(recipient),
    };
  }

  checkMessages(agentId: string, markAsRead = true): CheckMessagesResponse {
    const agent = this.requireAgent(agentId);
    const unread = this.unreadMessagesFor(agent.id);

    if (markAsRead) {
      for (const message of unread) {
        message.isRead = true;
      }
    }

    return {
      messages: unread.map((message) => this.toMessageInfo(message)),
    };
  }

  broadcastMessage(from: string, content: string): BroadcastResponse {
    const sender = this.requireAgent(from);
    const recipients = this.agentsInSameTeam(sender)
      .filter((agent) => agent.id !== sender.id && agent.isRegistered);

    for (const recipient of recipients) {
      const message = this.storeMessage(sender.id, recipient.id, content);
      this.onInboxMessage?.(recipient.id, message.id);
    }

    return {
      success: recipients.length > 0,
      recipientCount: recipients.length,
    };
  }

  async setStatus(agentId: string, status: string, announcement?: StatusAnnouncementInput): Promise<SetStatusResponse> {
    const agent = this.requireAgent(agentId);
    const normalizedAnnouncement = announcement
      ? this.normalizedAnnouncement(announcement)
      : undefined;
    agent.statusText = status.trim() || undefined;
    agent.updatedAt = this.now().toISOString();
    this.onAgentUpdated?.(agent);

    return {
      success: true,
      status: agent.statusText ?? null,
      ...(normalizedAnnouncement
        ? { announcement: await this.onAnnounce!(agent, normalizedAnnouncement.phase, normalizedAnnouncement.text) }
        : {}),
    };
  }

  clearStatus(agentId: string): boolean {
    const agent = this.getAgents().find((candidate) => candidate.id === agentId);
    if (!agent || agent.statusText === undefined) return false;
    delete agent.statusText;
    agent.updatedAt = this.now().toISOString();
    this.onAgentUpdated?.(agent);
    return true;
  }

  async finishTurn(agentId: string, input: FinishTurnInput = {}): Promise<FinishTurnResponse> {
    const agent = this.requireAgent(agentId);
    if (input.flag === 'delegate_to_worktree' && agent.delegatedByAgentId) {
      throw new McpToolError('delegate_to_worktree is unavailable because this agent is already a delegated co-agent.');
    }
    const normalizedAnnouncement = input.announcement
      ? this.normalizedAnnouncement({ phase: 'finish', text: input.announcement.text })
      : undefined;
    if (input.celebration && !this.onCelebrate) {
      throw new McpToolError('Celebrations are not available.');
    }
    delete agent.statusText;
    if (input.flag) agent.threadFlags = { [input.flag]: true };
    const suggestedPrompt = input.suggestedPrompt?.trim();
    if (suggestedPrompt) agent.suggestedPrompt = suggestedPrompt;
    else delete agent.suggestedPrompt;
    agent.updatedAt = this.now().toISOString();
    this.onAgentUpdated?.(agent);
    const [announcement, celebration] = await Promise.all([
      normalizedAnnouncement
        ? this.onAnnounce!(agent, normalizedAnnouncement.phase, normalizedAnnouncement.text)
        : undefined,
      input.celebration
        ? this.onCelebrate!(agent)
        : undefined,
    ]);
    return {
      success: true,
      status: null,
      ...(input.flag ? { flag: input.flag } : {}),
      ...(announcement ? { announcement } : {}),
      ...(celebration ? { celebration } : {}),
    };
  }

  async displayMarkdown(agentId: string, input: DisplayMarkdownInput): Promise<DisplayMarkdownResponse> {
    const agent = this.requireAgent(agentId);
    const markdown = input.markdown?.trim() ?? '';
    const filePath = input.path?.trim() ?? '';
    const title = input.title?.trim();
    if (Boolean(markdown) === Boolean(filePath)) {
      throw new McpToolError('Provide exactly one of markdown or path.');
    }
    if (!this.onDisplayMarkdown) {
      throw new McpToolError('Markdown display is not available.');
    }

    return this.onDisplayMarkdown(agent, {
      ...(markdown ? { markdown: input.markdown! } : {}),
      ...(filePath ? { path: filePath } : {}),
      ...(title ? { title } : {}),
    });
  }

  private normalizedAnnouncement(input: StatusAnnouncementInput): StatusAnnouncementInput {
    const normalizedText = input.text.trim();
    if (!normalizedText) {
      throw new McpToolError('Announcement text must not be empty.');
    }
    if (normalizedText.length > 160) {
      throw new McpToolError('Announcement text must be 160 characters or fewer.');
    }
    if (!this.onAnnounce) {
      throw new McpToolError('Spoken announcements are not available.');
    }
    return { phase: input.phase, text: normalizedText };
  }

  async submitMissionResult(agentId: string, input: MissionResultInput) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission result submission is unavailable.');
    return this.missionTools.submitResult(agentId, input);
  }

  async acquireMissionCommitLock(agentId: string, signal?: AbortSignal) {
    this.requireAgent(agentId);
    if (!this.missionTools?.acquireCommitLock) throw new McpToolError('Mission commit locking is unavailable.');
    return this.missionTools.acquireCommitLock(agentId, signal);
  }

  async releaseMissionCommitLock(agentId: string) {
    this.requireAgent(agentId);
    if (!this.missionTools?.releaseCommitLock) throw new McpToolError('Mission commit locking is unavailable.');
    return this.missionTools.releaseCommitLock(agentId);
  }

  async upsertMissionTicket(agentId: string, input: MissionTicketDraftInput) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission ticket drafting is unavailable.');
    return this.missionTools.upsertTicket(agentId, input);
  }

  missionContext(agentId: string): MissionToolContext | undefined {
    this.requireAgent(agentId);
    return this.missionTools?.contextForAgent(agentId);
  }

  async setMissionTitle(agentId: string, title: string) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission title updates are unavailable.');
    return this.missionTools.setTitle(agentId, title);
  }

  async attachMissionRepository(agentId: string, repoPath: string) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission repository attachment is unavailable.');
    return this.missionTools.attachRepository(agentId, repoPath);
  }

  listMissionArtifacts(agentId: string) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission artifact listing is unavailable.');
    return this.missionTools.listArtifacts(agentId);
  }

  async readMissionArtifact(agentId: string, stage: MissionStage) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission artifact reading is unavailable.');
    return this.missionTools.readArtifact(agentId, stage);
  }

  async writeMissionArtifact(agentId: string, input: MissionArtifactWriteInput) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission artifact writing is unavailable.');
    return this.missionTools.writeArtifact(agentId, input);
  }

  async reportMissionReviewFinding(agentId: string, input: MissionReviewFindingInput) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission review finding reporting is unavailable.');
    return this.missionTools.reportReviewFinding(agentId, input);
  }

  async updateMissionReviewFinding(agentId: string, input: MissionReviewFindingUpdateInput) {
    this.requireAgent(agentId);
    if (!this.missionTools) throw new McpToolError('Mission review finding updates are unavailable.');
    return this.missionTools.updateReviewFinding(agentId, input);
  }

  async updateWorkItem(agentId: string, workItemId: string, status: WorkBacklogAssignmentStatus, note?: string): Promise<UpdateWorkItemResponse> {
    const agent = this.requireAgent(agentId);
    const normalizedWorkItemId = workItemId.trim();
    if (!normalizedWorkItemId) {
      throw new McpToolError('Provide the work item ID from your assignment prompt.');
    }
    const normalizedNote = note?.trim();
    if (status === 'blocked' && !normalizedNote) {
      throw new McpToolError('Provide a concise note explaining what help or input is needed when blocking a work item.');
    }
    if (!this.onUpdateWorkItem) {
      throw new McpToolError('Work item updates are not available.');
    }

    return this.onUpdateWorkItem(agent, normalizedWorkItemId, status, normalizedNote);
  }

  async listSourceRepositories(agentId: string): Promise<{ repos: SourceRepository[] }> {
    this.requireAgent(agentId);
    if (!this.onListSourceRepositories) {
      throw new McpToolError('Source repositories are not available.');
    }

    return {
      repos: await this.onListSourceRepositories(),
    };
  }

  async listSourceWorktrees(agentId: string, repoPath: string): Promise<{ repoPath: string; worktrees: SourceWorktree[] }> {
    const normalizedRepoPath = repoPath.trim();
    const { repos } = await this.listSourceRepositories(agentId);
    const repository = repos.find((candidate) => candidate.path === normalizedRepoPath);
    if (!repository) {
      throw new McpToolError('Source repository not found.');
    }

    return {
      repoPath: normalizedRepoPath,
      worktrees: this.onListSourceWorktrees
        ? await this.onListSourceWorktrees(normalizedRepoPath)
        : repository.worktrees,
    };
  }

  async createSourceWorktree(agentId: string, input: CreateSourceWorktreeInput): Promise<SourceWorktree> {
    this.requireAgent(agentId);
    if (!this.onCreateSourceWorktree) {
      throw new McpToolError('Source worktree creation is not available.');
    }

    return this.onCreateSourceWorktree({
      repoPath: input.repoPath.trim(),
      branchName: input.branchName.trim(),
      ...(input.destinationPath?.trim() ? { destinationPath: input.destinationPath.trim() } : {}),
    });
  }

  async createAgent(agentId: string, input: McpCreateAgentInput): Promise<McpCreateAgentResponse> {
    const agent = this.requireAgent(agentId);
    if (!this.onCreateAgent) {
      throw new McpToolError('Agent creation is not available.');
    }

    return this.onCreateAgent(agent, {
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.task ? { task: input.task, requestId: input.requestId } : {}),
      name: input.name?.trim(),
      prompt: input.prompt?.trim() || undefined,
      instructions: input.instructions?.trim() || undefined,
      selection: executionSelectionOverridesSchema.parse({ ...input.selection, backend: input.selection?.backend ?? agent.backend }),
      repoPath: input.repoPath.trim(),
      createWorktree: input.createWorktree,
      startingContext: input.startingContext,
      branchName: input.branchName?.trim(),
      destinationPath: input.destinationPath?.trim() || undefined,
      teamId: agent.teamId,
    });
  }

  async closeAgent(callerAgentId: string, agentId: string) {
    this.requireAgent(callerAgentId);
    if (!this.onCloseAgent) throw new McpToolError('Agent closing is not available.');
    await this.onCloseAgent(callerAgentId, agentId);
    return { success: true, agentId };
  }

  latestUnreadMessageId(agentId: string): string | null {
    const agent = this.findAgent(agentId);
    if (!agent) {
      return null;
    }

    return this.unreadMessagesFor(agent.id).at(-1)?.id ?? null;
  }

  takeUnreadMessages(agentId: string): MessageInfo[] {
    const agent = this.findAgent(agentId);
    if (!agent) {
      return [];
    }

    const unread = this.unreadMessagesFor(agent.id);
    const messages = unread.map((message) => this.toMessageInfo(message));
    for (const message of unread) {
      message.isRead = true;
    }

    return messages;
  }

  peekUnreadMessages(agentId: string): MessageInfo[] {
    const agent = this.findAgent(agentId);
    return agent ? this.unreadMessagesFor(agent.id).map((message) => this.toMessageInfo(message)) : [];
  }

  markMessagesRead(messageIds: string[]): void {
    const ids = new Set(messageIds);
    for (const message of this.messages) {
      if (ids.has(message.id)) message.isRead = true;
    }
  }

  debugAgents(): McpAgentInfo[] {
    return this.getAgents().map((agent) => this.toAgentInfo(agent));
  }

  private storeMessage(from: string, to: string, content: string): McpMessage {
    const message: McpMessage = {
      id: this.createId(),
      from,
      to,
      content,
      timestamp: this.now(),
      isRead: false,
    };
    this.messages.push(message);

    this.cleanup();
    return message;
  }

  private listVisibleAgents(caller: Agent): McpAgentInfo[] {
    return this.agentsInSameTeam(caller).map((agent) => this.toAgentInfo(agent));
  }

  private agentsInSameTeam(caller: Agent): Agent[] {
    const agents = this.getAgents();
    if (caller.teamId) {
      return agents.filter((agent) => agent.teamId === caller.teamId);
    }

    return agents.filter((agent) => !agent.teamId);
  }

  private findAgentInSameTeam(caller: Agent, identifier: string): Agent | null {
    const visibleAgents = this.agentsInSameTeam(caller);
    const exactId = visibleAgents.find((agent) => agent.id === identifier);
    if (exactId) {
      return exactId;
    }

    const exactFolder = visibleAgents.find((agent) => agent.folder === identifier);
    if (exactFolder) {
      return exactFolder;
    }

    const normalized = identifier.toLowerCase();
    const nameMatches = visibleAgents.filter((agent) => agentDisplayName(agent).toLowerCase() === normalized);
    if (nameMatches.length > 1) {
      throw new McpToolError(`Failed to send message: Recipient name '${identifier}' is ambiguous. Use the recipient ID from list-agents.`);
    }

    return nameMatches[0] ?? null;
  }

  private requireAgent(identifier: string): Agent {
    const agent = this.findAgent(identifier);
    if (!agent) {
      throw new McpToolError(this.agentNotFoundMessage(identifier));
    }

    return agent;
  }

  private findAgent(identifier: string): Agent | null {
    return this.getAgents().find((agent) => matchesAgent(agent, identifier)) ?? null;
  }

  private unreadMessagesFor(agentId: string): McpMessage[] {
    return this.messages.filter((message) => message.to === agentId && !message.isRead);
  }

  private toAgentInfo(agent: Agent): McpAgentInfo {
    return {
      id: agent.id,
      name: agentDisplayName(agent),
      folder: agent.folder,
      status: agent.statusText ? `${agentStatusLabel(agent.status)}: ${agent.statusText}` : agentStatusLabel(agent.status),
    };
  }

  private toMessageInfo(message: McpMessage): MessageInfo {
    const sender = this.findAgent(message.from);
    return {
      id: message.id,
      from: sender ? agentDisplayName(sender) : message.from,
      fromId: message.from,
      content: message.content,
      timestamp: message.timestamp.toISOString(),
    };
  }

  private cleanup(): void {
    const readMessages = this.messages.filter((message) => message.isRead);
    if (readMessages.length <= 100) {
      return;
    }

    let removed = 0;
    const toRemove = readMessages.length - 100;
    for (let index = 0; index < this.messages.length; index += 1) {
      if (!this.messages[index]?.isRead) {
        continue;
      }
      if (removed >= toRemove) {
        break;
      }
      this.messages.splice(index, 1);
      index -= 1;
      removed += 1;
    }
  }

  private agentNotFoundMessage(identifier: string): string {
    const agents = this.getAgents();
    if (agents.length === 0) {
      return `Agent '${identifier}' not found. No agents are currently available.`;
    }

    const entries = agents.map((agent) => `- ${agent.id}: ${agentDisplayName(agent)} (${agent.folder})`).join('\n');
    return `Agent '${identifier}' not found. Visible agents:\n\n${entries}`;
  }
}

function matchesAgent(agent: Agent, identifier: string): boolean {
  return agent.id === identifier || agentDisplayName(agent).toLowerCase() === identifier.toLowerCase();
}

function agentStatusLabel(status: AgentStatus): string {
  switch (status.type) {
    case 'working':
      return literalAppText(status.detail) ?? 'Working';
    case 'awaitingInput':
      return literalAppText(status.detail) ?? 'Awaiting input';
    case 'error':
      return literalAppText(status.message) ? `Error: ${literalAppText(status.message)}` : 'Error';
    case 'idle':
      return 'Idle';
  }
}

function literalAppText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
