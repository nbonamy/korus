import type { ClaudeConversationEvent, ClaudeConversationSnapshot } from './contracts';
import {
  appendCompactionMarker,
  appendSystemMessage,
  assistantMessageId,
  completeAssistantMessage,
  ensureAssistantMessage,
  findCompactionMessages,
  pruneSupersededEmptyAssistantPlaceholders,
} from './claude-conversation-transcript';
import {
  applyApprovalRequest,
  applyToolInputRequest,
  updateAssistantToolPart,
  upsertAssistantToolPart,
} from './claude-conversation-tools';
import {
  appendAgentPlanMarkdownDelta,
  appendAssistantDeltaWithPlanFilter,
  planProgressOperation,
  updateAgentPlanMarkdown,
  upsertPlanProgressToolPart,
} from './claude-conversation-plans';

/** Applies one Agent SDK event to its provider-owned Claude conversation. */
export function applyClaudeConversationEvent(
  snapshot: ClaudeConversationSnapshot,
  event: ClaudeConversationEvent,
): void {
  if (event.agentId !== snapshot.agentId) return;

  if (event.type === 'turn.executionPlanUpdated') {
    snapshot.plan = event.payload.plan;
    return;
  }

  if (event.type === 'history.prepended') {
    if (event.backendSessionId !== snapshot.sessionId) return;
    const known = new Set(snapshot.messages.map((message) => message.id));
    const older = event.payload.messages.filter((message) => {
      if (message.agentId !== snapshot.agentId || known.has(message.id)) return false;
      known.add(message.id);
      return true;
    });
    snapshot.messages = [...older, ...snapshot.messages];
    snapshot.historyState = { hasOlder: event.payload.hasOlder, loadingOlder: false };
    return;
  }
  if (event.type === 'message.replaced') {
    const message = event.payload.message;
    if (message.agentId !== snapshot.agentId || event.backendSessionId !== snapshot.sessionId) return;
    const index = snapshot.messages.findIndex((candidate) => candidate.id === message.id);
    if (index < 0) {
      const before = snapshot.messages.findIndex(candidate => candidate.id === event.payload.beforeMessageId);
      snapshot.messages.splice(before < 0 ? snapshot.messages.length : before, 0, message);
    } else snapshot.messages[index] = message;
    return;
  }
  if (event.type === 'context.usageUpdated') {
    snapshot.contextUsage = event.payload.contextUsage;
    return;
  }

  if (event.type === 'turn.started') {
    ensureAssistantMessage(snapshot, event.agentId, event.turnId, assistantMessageId(event.turnId), event.occurredAt);
    pruneSupersededEmptyAssistantPlaceholders(snapshot, event.agentId);
    return;
  }

  if (event.type === 'turn.proposedPlanDelta') {
    const operation = planProgressOperation(snapshot, event.turnId);
    appendAgentPlanMarkdownDelta(snapshot, event.threadId, event.turnId, event.payload, event.occurredAt);
    if (snapshot.plan?.turnId === event.turnId) {
      upsertPlanProgressToolPart(
        snapshot,
        event.agentId,
        event.turnId,
        snapshot.plan.markdown,
        'running',
        operation,
        event.occurredAt,
      );
    }
    return;
  }

  if (event.type === 'turn.proposedPlanCompleted') {
    const operation = planProgressOperation(snapshot, event.turnId);
    updateAgentPlanMarkdown(snapshot, event.threadId, event.turnId, event.payload, event.occurredAt);
    if (snapshot.plan?.turnId === event.turnId) {
      upsertPlanProgressToolPart(
        snapshot,
        event.agentId,
        event.turnId,
        snapshot.plan.markdown,
        'completed',
        operation,
        event.occurredAt,
      );
    }
    return;
  }

  if (event.type === 'message.delta') {
    appendAssistantDeltaWithPlanFilter(
      snapshot,
      event.agentId,
      event.threadId,
      event.turnId,
      event.payload.delta,
      event.payload.itemId,
      event.occurredAt,
      event.payload.phase,
    );
    return;
  }

  if (event.type === 'message.userSubmitted') {
    const message = event.payload.message;
    if (message.agentId === event.agentId && !snapshot.messages.some((candidate) => candidate.id === message.id)) {
      snapshot.messages.push(message);
      pruneSupersededEmptyAssistantPlaceholders(snapshot, event.agentId);
    }
    return;
  }

  if (event.type === 'context.compactionStarted' || event.type === 'context.compactionCompleted') {
    if (event.type === 'context.compactionStarted') {
      appendCompactionMarker(snapshot, event.agentId, event.turnId, event.occurredAt);
    } else {
      for (const message of findCompactionMessages(snapshot, event.agentId, event.turnId)) {
        message.status = 'complete';
      }
    }
    return;
  }

  if (event.type === 'item.started') {
    upsertAssistantToolPart(snapshot, event.agentId, event.turnId, event.payload.toolPart, event.occurredAt);
    return;
  }

  if (event.type === 'item.updated') {
    updateAssistantToolPart(snapshot, event.agentId, event.turnId, event.payload, event.occurredAt);
    return;
  }

  if (event.type === 'approval.requested') {
    applyApprovalRequest(snapshot, event.agentId, event.turnId, event.payload, event.occurredAt);
    return;
  }

  if (event.type === 'toolInput.requested') {
    applyToolInputRequest(snapshot, event.agentId, event.turnId, event.payload, event.occurredAt);
    return;
  }

  if (event.type === 'turn.completed') {
    completeAssistantMessage(snapshot, event.agentId, event.turnId);
    return;
  }

  if (event.type === 'error') {
    if (event.payload.willRetry !== true) {
      appendSystemMessage(snapshot, event.agentId, event.payload.message, event.occurredAt);
    }
    return;
  }

  if (event.type === 'clientRequest.resolved' || event.type === 'turn.historyUpdated') return;

  const exhaustiveEvent: never = event;
  void exhaustiveEvent;
}
