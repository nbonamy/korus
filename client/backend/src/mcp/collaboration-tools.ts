import { product } from '@workspace/core/product';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { threadFlagIds } from '@workspace/core/thread-flags';
import type { AppMcpAgentCoordinator } from './agent-coordinator';
import { CHECK_INBOX_PROMPT } from './agent-prompts';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';
import { createAgentInputSchema } from './create-agent-schema';

export function createCollaborationToolModuleProvider(
  coordinator: AppMcpAgentCoordinator,
): AppMcpToolModuleProvider {
  return {
    id: 'collaboration',
    resolve: ({ agentId }) => ({
      id: 'collaboration',
      register: (server, surface) => registerCollaborationTools(
        server,
        coordinator,
        agentId,
        surface.proposedActions,
      ),
    }),
  };
}

function registerCollaborationTools(
  server: McpServer,
  coordinator: AppMcpAgentCoordinator,
  callerAgentId: string,
  allowProposedActions: boolean,
): void {
  server.registerTool('list-hosts', {
    description: 'List configured remote hosts and their current connection status.',
    inputSchema: {},
  }, () => loggedToolResult('list-hosts', { callerAgentId }, () => coordinator.listHosts(callerAgentId)));

  server.registerTool('list-agents', {
    description: 'List agents in your team, excluding provider-blocked conversations, with their ID, status, name, and folder. A remoteConnectionId identifies the host owning a remote folder; folders without it are local to the controlling daemon.',
    inputSchema: {},
  }, () => loggedToolResult('list-agents', { callerAgentId }, () => coordinator.listAgents(callerAgentId)));

  server.registerTool('send-message', {
    description: 'Send a message to another visible agent by ID or unambiguous name.',
    inputSchema: {
      to: z.string().describe('Recipient agent ID, or agent name when names are unambiguous.'),
      content: z.string().describe('Message content'),
    },
  }, ({ to, content }) => loggedToolResult('send-message', {
    from: callerAgentId,
    to,
    contentLength: content.length,
  }, () => coordinator.sendMessage(callerAgentId, to, content)));

  server.registerTool('check-messages', {
    description: `${CHECK_INBOX_PROMPT} Normal teammate messages are delivered directly as prompts, so only use this if explicitly asked to recover missed messages.`,
    inputSchema: {
      markAsRead: z.boolean().optional().describe('Mark messages as read (default: true)'),
    },
  }, ({ markAsRead }) => loggedToolResult('check-messages', {
    agentId: callerAgentId,
    markAsRead: markAsRead ?? true,
  }, () => coordinator.checkMessages(callerAgentId, markAsRead ?? true)));

  server.registerTool('broadcast-message', {
    description: 'Send a message to all other connected visible agents.',
    inputSchema: {
      content: z.string().describe('Message content'),
    },
  }, ({ content }) => loggedToolResult('broadcast-message', {
    from: callerAgentId,
    contentLength: content.length,
  }, () => coordinator.broadcastMessage(callerAgentId, content)));

  server.registerTool('set-status', {
    description: 'Set short activity status as the first action of a user task, with a start acknowledgment. Later direction changes omit announcement; finish_turn owns completion.',
    inputSchema: {
      status: z.string().describe('Short status text describing what you are currently doing. finish_turn or the provider turn lifecycle clears it.'),
      announcement: z.object({
        phase: z.literal('start').describe('Marks the acknowledgment as the start of the user task.'),
        text: z.string().trim().min(1).max(160).describe('One brief natural phrase, at most 160 characters.'),
      }).optional().describe('Optional spoken start acknowledgment for the first status update of each user task.'),
    },
  }, ({ status, announcement }) => loggedToolResult('set-status', {
    agentId: callerAgentId,
    statusLength: status.length,
    ...(announcement ? {
      announcementPhase: announcement.phase,
      announcementTextLength: announcement.text.length,
    } : {}),
  }, () => coordinator.setStatus(callerAgentId, status, announcement)));

  const finishTurnDescription = 'Required once as the last tool action before the final response. Requests the thread flag, suggested prompt, announcement and celebration; they take effect when the turn actually completes, after your final response. Offer work_proposed after a feature/design discussion identifies concrete separate work, even without approval to carry it out; the user chooses Continue, Delegate, Create Mission or Discard. A proposal does not authorize agents, Missions or starting work and must not replace work the user already requested here. Use ready_for_review for complete validated uncommitted work.';
  const finishTurnEffectsSchema = {
    suggestedPrompt: z.string().trim().min(1).max(240).optional().describe('Useful next request in the user’s voice; placeholder only, never submitted. Omission clears the previous hint.'),
    announcement: z.object({
      text: z.string().trim().min(1).max(160).describe('One brief natural completion phrase, at most 160 characters.'),
    }).optional().describe('Optional spoken completion acknowledgment. The finish phase is implied.'),
    celebration: z.boolean().optional().describe('Set true to celebrate a meaningful win. Korus chooses the visual effect.'),
  };
  if (allowProposedActions) {
    server.registerTool('finish_turn', {
      description: finishTurnDescription,
      inputSchema: {
        flag: z.enum(threadFlagIds).optional().describe('Optional thread flag. work_proposed offers separate work and is filtered unless this agent is on the repository’s default branch. ready_for_review is separate review readiness. Omit to preserve the existing flag.'),
        ...finishTurnEffectsSchema,
      },
    }, input => loggedToolResult('finish_turn', {
      agentId: callerAgentId,
      flag: input.flag ?? null,
      announcementTextLength: input.announcement?.text.length ?? null,
      celebration: input.celebration ?? false,
    }, () => coordinator.finishTurn(callerAgentId, input)));
  } else {
    server.registerTool('finish_turn', {
      description: `${finishTurnDescription} Workflow-managed agents do not expose proposed-action flags.`,
      inputSchema: finishTurnEffectsSchema,
    }, input => loggedToolResult('finish_turn', {
      agentId: callerAgentId,
      announcementTextLength: input.announcement?.text.length ?? null,
      celebration: input.celebration ?? false,
    }, () => coordinator.finishTurn(callerAgentId, input)));
  }

  server.registerTool('update-work-item', {
    description: `Update the lifecycle of a backlog work item assigned to you through ${product.name}. Use blocked with a note when you need help, inProgress when work resumes, readyForReview when the user can review the outcome, or completed when the assignment explicitly requires completion.`,
    inputSchema: {
      workItemId: z.string().describe('Exact Work item ID from the assignment prompt, for example github:owner/repo#123.'),
      status: z.enum(['blocked', 'completed', 'inProgress', 'readyForReview']).describe(`New ${product.name} assignment lifecycle status.`),
      note: z.string().optional().describe('Concise context for the user. Required when status is blocked.'),
    },
  }, ({ workItemId, status, note }) => loggedToolResult('update-work-item', {
    agentId: callerAgentId,
    status,
    workItemIdLength: workItemId.length,
  }, () => coordinator.updateWorkItem(callerAgentId, workItemId, status, note)));

  server.registerTool('list-repos', {
    description: 'List git repositories in the configured source folder on this computer or the selected remote host.',
    inputSchema: { remoteConnectionId: z.string().trim().min(1).optional().describe('Remote host ID from list-hosts; omit for this computer.') },
  }, ({ remoteConnectionId }) => loggedToolResult('list-repos', {
    agentId: callerAgentId,
  }, () => remoteConnectionId ? coordinator.listSourceRepositories(callerAgentId, remoteConnectionId) : coordinator.listSourceRepositories(callerAgentId)));

  server.registerTool('list-worktrees', {
    description: 'List all discovered worktrees for a source repository.',
    inputSchema: {
      repoPath: z.string().describe('Path to the source repository.'),
      remoteConnectionId: z.string().trim().min(1).optional().describe('Host ID from list-hosts; omit for your current host.'),
    },
  }, ({ repoPath, remoteConnectionId }) => loggedToolResult('list-worktrees', {
    agentId: callerAgentId,
    repoPath,
  }, () => remoteConnectionId ? coordinator.listSourceWorktrees(callerAgentId, repoPath, remoteConnectionId) : coordinator.listSourceWorktrees(callerAgentId, repoPath)));

  server.registerTool('create-worktree', {
    description: 'Create a new git worktree from a source repository and return the created folder.',
    inputSchema: {
      repoPath: z.string().describe('Path to the source repository.'),
      remoteConnectionId: z.string().trim().min(1).optional().describe('Host ID from list-hosts; omit for your current host.'),
      branchName: z.string().describe('Branch name for the new worktree.'),
      destinationPath: z.string().optional().describe('Optional destination path. Defaults to a sibling folder named <repo>-<branch>.'),
    },
  }, ({ repoPath, branchName, destinationPath, remoteConnectionId }) => loggedToolResult('create-worktree', {
    agentId: callerAgentId,
    repoPath,
    branchName,
  }, () => coordinator.createSourceWorktree(callerAgentId, { repoPath, branchName, destinationPath, ...(remoteConnectionId ? { remoteConnectionId } : {}) })));

  server.registerTool('create-agent', {
    description: `Create one or more ${product.name} co-agents in your team using targets (one target for a single agent). Top-level settings are shared defaults; target settings override them. Each result reports its own success or failure; successful targets are preserved. Omitting a target prompt leaves that agent idle. Sidebar organization is unchanged. Targets may use other hosts or isolated worktrees. Use list-hosts to discover current host IDs and status. Read korus-delegation before delegating. With a prompt, returns after startup acceptance, not task completion.`,
    inputSchema: createAgentInputSchema,
  }, input => loggedToolResult('create-agent', {
    agentId: callerAgentId,
    targetCount: input.targets?.length ?? 1,
    createWorktree: input.createWorktree === true,
  }, () => coordinator.createAgent(callerAgentId, input.targets ? {
    featureLabel: input.featureLabel,
    selection: input.selection,
    branchName: input.branchName,
    createWorktree: input.createWorktree,
    startingContext: input.startingContext,
    planMode: input.planMode,
    goal: input.goal,
    instructions: input.instructions,
    targets: input.targets,
  } : { ...input, repoPath: input.repoPath! })));

  server.registerTool('close-agent', {
    description: 'Close an idle agent you created. Unfinished tasks must be completed or cancelled first. Preserves its worktree and branches.',
    inputSchema: z.strictObject({ agentId: z.string().trim().min(1).describe('Exact ID of the agent to close.') }),
  }, ({ agentId }) => loggedToolResult('close-agent', { callerAgentId, agentId }, () => coordinator.closeAgent(callerAgentId, agentId)));

  server.registerTool('display-markdown', {
    description: `Present Markdown in ${product.name}. Mission agents request opening a document; the user chooses whether to open it. Other conversations display it in the side panel. Plan-mode proposals open automatically through native plan output; do not display a second copy here. Provide exactly one of path or markdown. Use path for Markdown files in your agent folder; use markdown for inline generated content.`,
    inputSchema: {
      path: z.string().optional().describe('Markdown file path relative to your agent folder, or an absolute path inside it.'),
      markdown: z.string().optional().describe('Inline Markdown content to display.'),
      title: z.string().optional().describe('Optional title for the side panel.'),
    },
  }, ({ path, markdown, title }) => loggedToolResult('display-markdown', {
    agentId: callerAgentId,
    hasPath: Boolean(path),
    hasMarkdown: Boolean(markdown),
    titleLength: title?.length ?? 0,
  }, () => coordinator.displayMarkdown(callerAgentId, { path, markdown, title })));
}
