import type {
  ClaudeConversationEvent,
  ClaudeConversationSnapshot,
  ThreadPlan,
} from './contracts';
import type { ToolPart } from './claude-conversation-payloads';
import {
  appendAssistantDelta,
  findAssistantMessageWithToolPart,
} from './claude-conversation-transcript';
import { upsertAssistantToolPart } from './claude-conversation-tools';

export function appendAgentPlanMarkdownDelta(
  snapshot: ClaudeConversationSnapshot,
  threadId: string,
  turnId: string,
  payload: ConversationEventPayload<'turn.proposedPlanDelta'>,
  updatedAt: string,
): void {
  if (!payload.delta) {
    return;
  }

  const existingMarkdown = snapshot.plan?.turnId === turnId ? snapshot.plan.markdown : '';
  setAgentPlanMarkdown(snapshot, threadId, turnId, `${existingMarkdown}${payload.delta}`, updatedAt, 'inProgress', { trim: false });
}

export function updateAgentPlanMarkdown(
  snapshot: ClaudeConversationSnapshot,
  threadId: string,
  turnId: string,
  payload: ConversationEventPayload<'turn.proposedPlanCompleted'>,
  updatedAt: string,
): void {
  setAgentPlanMarkdown(snapshot, threadId, turnId, payload.markdown, updatedAt, 'completed');
}

function setAgentPlanMarkdown(snapshot: ClaudeConversationSnapshot, threadId: string, turnId: string, markdown: string, updatedAt: string, status: ThreadPlan['status'], options: { trim?: boolean } = {}): void {
  const content = markdown.trim();
  if (!content) {
    return;
  }
  const nextMarkdown = options.trim === false ? markdown : content;

  if (
    snapshot.plan?.turnId === turnId &&
    snapshot.plan.kind === 'proposed' &&
    snapshot.plan.status === status &&
    snapshot.plan.markdown === nextMarkdown
  ) {
    return;
  }

  snapshot.plan = {
    threadId,
    turnId,
    kind: 'proposed',
    status,
    explanation: '',
    steps: [],
    markdown: nextMarkdown,
    updatedAt,
  };
}

export function appendAssistantDeltaWithPlanFilter(
  snapshot: ClaudeConversationSnapshot,
  agentId: string,
  threadId: string | undefined,
  turnId: string,
  delta: string,
  itemId: string | undefined,
  updatedAt: string,
  phase?: ConversationEventPayload<'message.delta'>['phase'],
): void {
  if (!delta) {
    return;
  }

  if (!threadId) {
    appendAssistantDelta(snapshot, agentId, turnId, delta, updatedAt, itemId, phase);
    return;
  }

  let remaining = delta;
  let capturing = isCapturingProposedPlan(snapshot, agentId, turnId);
  const operation = planProgressOperation(snapshot, turnId);

  while (remaining) {
    if (capturing) {
      const closeIndex = lowerIndexOf(remaining, '</proposed_plan>');
      const planDelta = closeIndex >= 0 ? remaining.slice(0, closeIndex) : remaining;
      if (planDelta) {
        appendAgentPlanMarkdownText(snapshot, threadId, turnId, planDelta, updatedAt);
      }
      if (closeIndex >= 0 && snapshot.plan?.turnId === turnId) {
        setAgentPlanMarkdown(snapshot, threadId, turnId, snapshot.plan.markdown, updatedAt, 'completed');
      }
      if (snapshot.plan?.turnId === turnId) {
        upsertPlanProgressToolPart(
          snapshot,
          agentId,
          turnId,
          snapshot.plan.markdown,
          closeIndex >= 0 ? 'completed' : 'running',
          operation,
          updatedAt,
          closeIndex < 0,
        );
      }

      if (closeIndex < 0) {
        return;
      }

      remaining = remaining.slice(closeIndex + '</proposed_plan>'.length);
      capturing = false;
      continue;
    }

    const openIndex = lowerIndexOf(remaining, '<proposed_plan>');
    if (openIndex < 0) {
      appendAssistantDelta(snapshot, agentId, turnId, remaining, updatedAt, itemId, phase);
      return;
    }

    const visibleDelta = remaining.slice(0, openIndex);
    if (visibleDelta) {
      appendAssistantDelta(snapshot, agentId, turnId, visibleDelta, updatedAt, itemId, phase);
    }

    remaining = remaining.slice(openIndex + '<proposed_plan>'.length);
    capturing = true;
    upsertPlanProgressToolPart(
      snapshot,
      agentId,
      turnId,
      snapshot.plan?.turnId === turnId ? snapshot.plan.markdown : '',
      'running',
      operation,
      updatedAt,
      true,
    );
  }
}

function appendAgentPlanMarkdownText(snapshot: ClaudeConversationSnapshot, threadId: string, turnId: string, delta: string, updatedAt: string): void {
  const existingMarkdown = snapshot.plan?.turnId === turnId ? snapshot.plan.markdown : '';
  setAgentPlanMarkdown(snapshot, threadId, turnId, `${existingMarkdown}${delta}`, updatedAt, 'inProgress', { trim: false });
}

function lowerIndexOf(value: string, search: string): number {
  return value.toLowerCase().indexOf(search.toLowerCase());
}

export function planProgressOperation(snapshot: ClaudeConversationSnapshot, turnId: string): 'update' | 'write' {
  return snapshot.plan && snapshot.plan.turnId !== turnId ? 'update' : 'write';
}

function isCapturingProposedPlan(snapshot: ClaudeConversationSnapshot, agentId: string, turnId: string): boolean {
  return Boolean(planProgressToolPart(snapshot, agentId, turnId)?.metadata?.capturingProposedPlan);
}

function planProgressToolPart(snapshot: ClaudeConversationSnapshot, agentId: string, turnId: string): ToolPart | undefined {
  const message = findAssistantMessageWithToolPart(snapshot, agentId, turnId, planProgressToolPartId(turnId));
  return message?.parts.find((part): part is ToolPart => part.type === 'tool' && part.id === planProgressToolPartId(turnId));
}

export function upsertPlanProgressToolPart(
  snapshot: ClaudeConversationSnapshot,
  agentId: string,
  turnId: string,
  markdown: string,
  status: ToolPart['status'],
  operation: 'update' | 'write',
  createdAt: string,
  capturingProposedPlan = false,
): void {
  upsertAssistantToolPart(snapshot, agentId, turnId, {
    type: 'tool',
    id: planProgressToolPartId(turnId),
    kind: 'generic',
    title: 'plan',
    status,
    statusText: JSON.stringify({
      source: 'codex',
      action: 'plan',
      phase: status,
      params: {
        addedLines: planLineCount(markdown),
        operation,
        target: 'plan',
      },
    }),
    metadata: {
      capturingProposedPlan,
      planProgress: true,
    },
  }, createdAt);
}

function planProgressToolPartId(turnId: string): string {
  return `plan-${turnId}`;
}

function planLineCount(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => line.trim()).length;
}

type ConversationEventPayload<Type extends ClaudeConversationEvent['type']> =
  Extract<ClaudeConversationEvent, { type: Type }>['payload'];
