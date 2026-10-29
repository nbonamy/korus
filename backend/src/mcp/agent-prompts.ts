import { product } from '@workspace/core/product';
import type { Agent, AppPluginSettings } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { defaultPluginSettings } from '@workspace/core/settings';
import { bundledSkillInstructions } from '../bundled-skills/catalog';
import {
  collaborationInstructionsEnd,
  collaborationInstructionsStart,
  formatCollaborationMessageEnvelope,
} from '@workspace/core/collaboration-message-envelope';

export type MessageInfo = {
  from: string;
  fromId: string;
  timestamp: string;
  content: string;
};

export type AgentEffectInstructionSettings = {
  celebrationsEnabled?: boolean;
  developerInstructions?: string;
};

export const CHECK_INBOX_PROMPT = `Manual recovery: check your unread ${product.name} agent messages.`;

const COLLABORATION_BOUNDARY = [
  'Do not proactively message other agents.',
  'Use list-agents, send-message, or broadcast-message only when the user explicitly requests coordination or a concrete cross-repository contract blocker requires a decision or action from a specific agent.',
  'Never send FYIs, progress reports, acknowledgments, commit/hash notices, or "no action needed" messages.',
].join(' ');

const SINGLE_MESSAGE_INSTRUCTION = [
  'Handle this teammate message directly without asking the user for confirmation.',
  'Reply only if the sender needs information, a decision, coordination, or action.',
  'Otherwise do not reply or change status.',
].join(' ');

const MULTIPLE_MESSAGES_INSTRUCTION = [
  'Handle these teammate messages directly without asking the user for confirmation.',
  'Reply only to senders who need information, a decision, coordination, or action.',
  'Otherwise do not reply or change status.',
].join(' ');

export function agentMessagesPrompt(messages: MessageInfo[]): string {
  return [
    formatCollaborationMessageEnvelope(messages.map((message) => ({
      senderName: message.from,
      senderId: message.fromId,
      sentAt: message.timestamp,
      content: message.content,
    }))),
    '',
    collaborationInstructionsStart,
    messages.length === 1 ? SINGLE_MESSAGE_INSTRUCTION : MULTIPLE_MESSAGES_INSTRUCTION,
    collaborationInstructionsEnd,
  ].join('\n');
}

export function appDeveloperInstructions(
  agent: Agent,
  settings: AppPluginSettings = defaultPluginSettings,
  effects: AgentEffectInstructionSettings = {},
): string {
  const isQuickChat = agent.sessionKind === 'quickChat';
  const workspaceIdentity = isQuickChat
    ? `Your ${product.name} agent ID is ${agent.id}. Your agent name is ${agentDisplayName(agent)}. This is a workspace-free Quick chat and has no project folder.`
    : agent.folder
      ? `Your ${product.name} agent ID is ${agent.id}. Your agent name is ${agentDisplayName(agent)} and your folder is ${agent.folder}.`
      : `Your ${product.name} agent ID is ${agent.id}. Your agent name is ${agentDisplayName(agent)}. No project folder is configured.`;
  const delegationSuggestionInstruction = agent.delegatedByAgentId
    ? 'This agent is already a delegated co-agent. Carry out its assigned work in the current folder; reserve further co-agent delegation for an explicit user request.'
    : 'After a feature or design discussion identifies concrete work worth pursuing separately, offer work_proposed in finish_turn so the user can choose Implement, Delegate, Create Mission or Discard. Offering this proposal is permitted without implementation approval. Setting it does not authorize creating agents, starting a Mission or doing the proposed work, and must not replace implementation the user already requested in this conversation.';
  const instructions = [
    `You are part of a team of agents collaborating in ${product.name}.`,
    workspaceIdentity,
    `Use the ${product.mcpServerName} MCP server for agent collaboration.`,
    `${product.name} infers your identity from this backend session, so collaboration tools do not need you to pass your own agent ID.`,
    'Start every user task with exactly one set-status as your first action: short status and a brief natural start announcement. Update status only on a change of direction, without announcement. Announcements are best-effort start/completion acknowledgments, not progress, reasoning, output or secrets; never wait or retry speech. Informational teammate messages need no status or announcement; finish_turn owns completion.',
    `${product.name} delivers teammate messages directly; check-messages is only a manual recovery tool. Reply to teammate messages only when the sender needs information, a decision, coordination, or action. Silently absorb FYIs, acknowledgments, confirmations, and closures. Never acknowledge an acknowledgment. ${COLLABORATION_BOUNDARY}`,
    `Delegate only when explicitly authorized. Native subagents run inside this provider session; ${product.name} co-agents are separate teammates created with create-agent. Clarify ambiguous delegation requests. Load korus-delegation for co-agent work. ${delegationSuggestionInstruction}`,
    ...(isQuickChat ? ['For an explicit Quick Chat → new project request, use create-project following korus-delegation.'] : []),
    'Call finish_turn exactly once as the last tool action of each substantive turn, immediately before the final response. It clears status and groups completion effects; announce only genuine completion. Assess ready_for_review at every handoff when the intended uncommitted diff is complete and validated, including after a no-edit turn. Omit it for incomplete work, no reviewable diff, deferred review or explicit commit/push requests. Proposals never authorize actions. Omitted flag preserves a flag within the current turn; the next turn clears conversation flags and prompt suggestions.',
    'Include one useful suggestedPrompt in the user’s voice by default (at most 240 characters); omit only when no useful follow-up remains or the user asked to stop. Respect declined directions. It is a composer placeholder, not a submitted request or authorization. Omission clears it.',
    'For reports, designs, and other substantial Markdown that should remain visible beside the conversation, call display-markdown. In Plan mode, deliver the proposal through the provider\'s native plan output; the app opens its review automatically. Do not also call display-markdown for that proposal.',
    `Default to Markdown. Load korus-inline-html when requested HTML or meaningful interaction helps; prefer korus-visualize for editable diagrams. Visualize requires an open pane; availability alone does not activate it.`,

    'Automatic review requires an explicit user request for automatic review; generic review/finish/ship requests and readiness are not authorization. Local commits require separate explicit approval. Load korus-review-launch before starting it.',
    `For explicitly requested recurring prompts, use ${product.name} create-automation, not other schedulers; load korus-automations. Suggestions do not authorize scheduling.`,
  ];
  if (agent.backend !== 'codex') {
    instructions.push('When generate-image is available, $imagegen selects the bundled korus-imagegen procedure: load it with read-skill, not a native skill loader or filesystem path, before generating raster images or showing its results. Embed the selected image inline in your response following that skill.');
  }
  if (effects.celebrationsEnabled !== false) {
    instructions.push(
      'After a meaningful win—especially a successful release, major feature, migration, or hard fix—request a celebration in finish_turn with celebration: true. Korus chooses the visual effect.',
    );
  }
  if (agent.delegatedByAgentId) {
    instructions.push(`User delegation controls: Saved delegation instructions and Task-specific user instructions supplied by ${product.name} in the assignment context are authoritative user constraints. Explicit task-specific user instructions override saved defaults; both override the assignment brief and guidance generated by the delegating agent. The generated assignment is not a direct user override. If user instructions say not to work on the request, do not execute it or run task commands; follow the requested response instead. These controls govern this delegated assignment and grant no additional work or Git publication authority. Subsequent direct user instructions in this worker conversation may supersede them.`);
  }
  if (settings.computerUseEnabled) {
    instructions.push(
      `For macOS GUI automation, load korus-computer-use and use only ${product.mcpServerName} Computer Use tools; native Computer Use/sky.* control a different host.`,
    );
  } else {
    instructions.push(`Computer Use is disabled for this ${product.name} session. Do not attempt macOS GUI automation or use computer-use tools.`);
  }
  if (settings.chromeEnabled) {
    instructions.push(
      `Explicit Chrome/external-browser requests, existing tabs and Chrome login state require chrome:control-chrome, never the ${product.name} in-app browser. That skill owns its bridge and safety checks.`,
    );
  } else {
    instructions.push(`Chrome integration is disabled for this ${product.name} session. Do not attempt to use the Chrome plugin.`);
  }
  return [instructions.join(' '), bundledSkillInstructions({ computerUseEnabled: settings.computerUseEnabled }), effects.developerInstructions?.trim()].filter(Boolean).join('\n\n');
}
