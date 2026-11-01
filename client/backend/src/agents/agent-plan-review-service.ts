import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import {
  agentConversationId,
  isPlanReviewDraft,
  planReviewFeedback,
  type PlanReview,
  type PlanReviewResponse,
} from '@workspace/core/plan-review';

/** One review lifecycle for native Markdown proposals, drafts and explicit decisions. */
export class AgentPlanReviewService {
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly options: {
      submit: (agent: Agent, prompt: string, planMode: boolean) => Promise<void>;
      persist: () => Promise<unknown>;
      emit: (event: BackendEvent) => void;
    },
  ) {}

  async respond(agent: Agent, response: PlanReviewResponse): Promise<void> {
    const review = agent.planReview;
    if (
      !review ||
      review.id !== response.reviewId ||
      review.conversationId !== agentConversationId(agent)
    )
      throw new Error('This plan review no longer belongs to the active conversation.');
    if (!['save', 'accept', 'revise', 'cancel'].includes(response.resolution))
      throw new Error('Invalid review resolution.');
    if (this.inFlight.has(agent.id))
      throw new Error('A decision for this plan review is already being submitted.');
    if (review.deliveryPending)
      throw new Error('Feedback delivery is unconfirmed. Check the conversation before retrying.');
    if (review.status !== 'pending') {
      if (review.status === response.resolution) return;
      throw new Error('This plan review has already been resolved.');
    }
    if (response.draftVersion !== undefined && response.draftVersion !== (review.draftVersion ?? 0))
      throw new Error('The feedback changed in another window. Reload before responding.');
    if (
      response.resolution === 'save' &&
      (response.draftVersion === undefined || !isPlanReviewDraft(response.draft))
    )
      throw new Error('Invalid plan feedback.');
    if (response.resolution === 'accept' && review.canApprove === false)
      throw new Error('This saved plan requires a new native proposal before approval.');
    if (
      response.resolution === 'revise' &&
      !response.feedback?.trim() &&
      !review.draft?.comments.length &&
      !review.draft?.choices.length
    )
      throw new Error('Revision feedback is required.');
    this.inFlight.add(agent.id);
    try {
      if (response.resolution === 'save') {
        await this.replace(agent, review, {
          ...review,
          draft: structuredClone(response.draft!),
          draftVersion: (review.draftVersion ?? 0) + 1,
        });
        return;
      }
      if (response.resolution !== 'cancel') {
        const pending = { ...review, deliveryPending: true };
        await this.replace(agent, review, pending);
        if (agent.planReview !== pending || agentConversationId(agent) !== review.conversationId)
          throw new Error('The conversation changed while the plan decision was being submitted.');
        try {
          await this.options.submit(
            agent,
            response.resolution === 'accept'
              ? 'implement the plan'
              : response.feedback?.trim() || planReviewFeedback(review),
            response.resolution === 'revise',
          );
        } catch (error) {
          if (agent.planReview === pending) await this.replace(agent, pending, review);
          throw error;
        }
        if (agent.planReview !== pending || agentConversationId(agent) !== review.conversationId)
          throw new Error('The conversation changed while the plan decision was being submitted.');
      }
      await this.replace(agent, agent.planReview!, { ...review, status: response.resolution });
      this.options.emit({
        type: 'plan.reviewResolved',
        agentId: agent.id,
        conversationId: review.conversationId ?? undefined,
        payload: { reviewId: review.id, resolution: response.resolution },
      });
    } finally {
      this.inFlight.delete(agent.id);
    }
  }
  private async replace(agent: Agent, previous: PlanReview, next: PlanReview) {
    agent.planReview = next;
    try {
      await this.options.persist();
    } catch (error) {
      if (agent.planReview === next) agent.planReview = previous;
      throw error;
    }
  }
}
