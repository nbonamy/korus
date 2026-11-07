import type { AppSnapshot, TurnGitDiff } from './contracts';
import { setAgentStatusInSnapshot } from './agent-manager';
import type { SnapshotEventOwnedBy } from './snapshot-event-ownership';
import { agentConversationId, planReviewFromEvent } from './plan-review';

/** Applies App-owned prompt, approval, and diff projections. */
export function applyCoordinationEventToSnapshot(
  snapshot: AppSnapshot,
  event: SnapshotEventOwnedBy<'coordination'>,
): void {
  if (!event.agentId) return;

  if (event.type === 'plan.readyForReview') {
    const agent = snapshot.agents.find((candidate) => candidate.id === event.agentId);
    if (agent && (!event.conversationId || event.conversationId === agentConversationId(agent))) {
      const review = planReviewFromEvent(agent, event);
      // Replayed provider completion must not reopen an already resolved review.
      if (agent.planReview?.id !== review.id) agent.planReview = review;
    }
    return;
  }
  if (event.type === 'plan.reviewResolved') {
    const review = snapshot.agents.find((candidate) => candidate.id === event.agentId)?.planReview;
    if (review?.id === event.payload.reviewId) review.status = event.payload.resolution;
    return;
  }

  if (event.type === 'agent.promptQueued') {
    const queuedPrompts = snapshot.queuedPrompts ?? [];
    if (!queuedPrompts.some((prompt) => prompt.agentId === event.agentId && prompt.id === event.payload.id)) {
      snapshot.queuedPrompts = [...queuedPrompts, {
        id: event.payload.id,
        agentId: event.agentId,
        text: event.payload.text,
        createdAt: event.occurredAt,
        ...(event.payload.options ? { options: event.payload.options } : {}),
        ...(event.payload.submitted === true ? { submitted: true } : {}),
      }];
    }
    return;
  }

  if (event.type === 'agent.promptRetryScheduled') {
    const prompt = (snapshot.queuedPrompts ?? []).find((candidate) => (
      candidate.agentId === event.agentId && candidate.id === event.payload.id
    ));
    if (!prompt) return;
    prompt.attempts = event.payload.attempts;
    prompt.lastError = event.payload.lastError;
    prompt.submitted = true;
    if (event.payload.retryAt !== undefined) prompt.retryAt = event.payload.retryAt;
    else delete prompt.retryAt;
    return;
  }

  if (event.type === 'agent.promptDequeued') {
    const ids = new Set(event.payload.ids);
    snapshot.queuedPrompts = (snapshot.queuedPrompts ?? []).filter((prompt) => (
      prompt.agentId !== event.agentId || !ids.has(prompt.id)
    ));
    return;
  }

  if (event.type === 'agentRequest.created') {
    const requests = snapshot.agentRequests ??= {};
    const request = event.payload.request;
    requests[event.agentId] = [...(requests[event.agentId] ?? []).filter((item) => item.id !== request.id), request];
    if (request.kind !== 'approval') return;
    const approvals = snapshot.backendApprovals[event.agentId] ?? [];
    snapshot.backendApprovals[event.agentId] = [
      ...approvals.filter((candidate) => candidate.id !== request.id),
      request.approval,
    ];
    setAgentStatusInSnapshot(snapshot, event.agentId, {
      type: 'awaitingInput',
      detail: request.approval.title,
    }, event.occurredAt);
    return;
  }

  if (event.type === 'agentRequest.resolved') {
    const pending = snapshot.agentRequests?.[event.agentId]?.find((request) => request.id === event.payload.id);
    if (pending && event.conversationId && pending.conversationId !== event.conversationId) return;
    const review = snapshot.agents.find(agent => agent.id === event.agentId)?.planReview;
    if (review?.requestId === event.payload.id && review.status === 'pending' && !review.deliveryPending &&
        review.conversationId === event.conversationId) {
      const outcome = event.payload.outcome;
      review.status = outcome.kind === 'decision' && outcome.decision === 'allow' ? 'accept'
        : outcome.kind === 'decision' && outcome.feedback ? 'revise' : 'cancel';
    }
    if (snapshot.agentRequests) snapshot.agentRequests[event.agentId] = (snapshot.agentRequests[event.agentId] ?? []).filter((request) => request.id !== event.payload.id);
    snapshot.backendApprovals[event.agentId] = (snapshot.backendApprovals[event.agentId] ?? [])
      .filter((candidate) => candidate.id !== event.payload.id);
    return;
  }

  if (event.type === 'conversation.turnDiffUpdated') {
    const { addedLines, removedLines } = event.payload;
    if (!addedLines && !removedLines) return;
    const diff: TurnGitDiff = {
      agentId: event.agentId,
      turnId: event.turnId,
      addedLines,
      removedLines,
      updatedAt: event.occurredAt,
      ...(event.payload.diff ? { diff: event.payload.diff } : {}),
    };
    snapshot.turnGitDiffs = { ...snapshot.turnGitDiffs, [event.turnId]: diff };
    return;
  }

  const exhaustiveEvent: never = event;
  void exhaustiveEvent;
}
