import { randomUUID } from "node:crypto";
import type { Agent } from "@workspace/core/contracts";
import { agentConversationId } from "@workspace/core/plan-review";
import {
  interactivePlanFeedback,
  isInteractivePlanDocument,
  isInteractivePlanResponse,
  isPlanAnswers,
  type InteractivePlan,
  type InteractivePlanResponse,
  type PublishInteractivePlan,
} from "@workspace/core/interactive-plan";

/** Coordinates planning artifacts, never provider transcripts or approval decisions. */
export class InteractivePlanService {
  private readonly busy = new Set<string>();
  constructor(
    private readonly options: {
      persist: () => Promise<unknown>;
      publish: () => void;
      submit: (agent: Agent, prompt: string) => Promise<void>;
    },
  ) {}
  read(agent: Agent): InteractivePlan {
    const plan = agent.interactivePlan;
    if (
      !plan ||
      plan.agentId !== agent.id ||
      plan.conversationId !== agentConversationId(agent)
    )
      throw new Error("This plan does not belong to the active conversation.");
    return plan;
  }
  async publish(
    agent: Agent,
    input: PublishInteractivePlan,
  ): Promise<InteractivePlan> {
    if (!isInteractivePlanDocument(input.document))
      throw new Error("Invalid interactive plan document.");
    const conversationId = agentConversationId(agent);
    if (!conversationId)
      throw new Error("Start a conversation before publishing a plan.");
    const previous = agent.interactivePlan;
    const existing =
      previous?.agentId === agent.id &&
      previous.conversationId === conversationId
        ? previous
        : undefined;
    if (input.planId !== undefined) {
      const current = this.read(agent);
      if (
        current.id !== input.planId ||
        current.revision !== input.expectedRevision
      )
        throw new Error(
          "The plan revision changed. Read it before replacing it.",
        );
      if (current.history.length >= 20)
        throw new Error("Start a new plan after 20 revisions.");
    } else if (input.expectedRevision !== undefined)
      throw new Error("A revision requires a plan ID.");
    else if (existing)
      throw new Error(
        "An existing plan must be revised with its plan ID and expected revision.",
      );
    return this.lock(agent.id, async () => {
      const current = input.planId ? previous : undefined;
      const next: InteractivePlan = {
        agentId: agent.id,
        conversationId,
        id: input.planId ?? randomUUID(),
        revision: (current?.revision ?? 0) + 1,
        document: structuredClone(input.document),
        answers: { choices: {}, comments: {} },
        answerVersion: 0,
        submitted: false,
        history: current
          ? [
              ...current.history,
              {
                revision: current.revision,
                answers: structuredClone(current.answers),
                submitted: current.submitted,
              },
            ]
          : [],
      };
      await this.replace(agent, previous, next);
      return next;
    });
  }
  async respond(
    agent: Agent,
    response: InteractivePlanResponse,
  ): Promise<void> {
    if (!isInteractivePlanResponse(response))
      throw new Error("Invalid plan response.");
    if (this.busy.has(agent.id))
      throw new Error("A plan operation is already in progress.");
    const plan = this.read(agent);
    if (plan.id !== response.planId || plan.revision !== response.revision)
      throw new Error("The plan revision changed. Reload before responding.");
    if (!isPlanAnswers(response.answers, plan.document))
      throw new Error("Invalid plan answers.");
    if (plan.deliveryPending)
      throw new Error(
        "Feedback delivery is unconfirmed. Check the conversation before publishing a new revision.",
      );
    if (plan.submitted) {
      if (
        response.action === "submit" &&
        response.answerVersion === plan.answerVersion - 1 &&
        JSON.stringify(response.answers) === JSON.stringify(plan.answers)
      )
        return;
      throw new Error("Feedback for this revision was already submitted.");
    }
    if (plan.answerVersion !== response.answerVersion)
      throw new Error(
        "The answers changed in another window. Reload before responding.",
      );
    const answers = structuredClone(response.answers);
    return this.lock(agent.id, async () => {
      if (response.action === "save") {
        await this.replace(agent, plan, {
          ...plan,
          answers,
          answerVersion: plan.answerVersion + 1,
        });
        return;
      }
      // Persist intent before provider delivery. A crash or uncertain final write
      // cannot make a retry send the same feedback twice.
      const pending = { ...plan, answers, deliveryPending: true };
      await this.replace(agent, plan, pending);
      try {
        await this.options.submit(
          agent,
          interactivePlanFeedback(plan, answers),
        );
      } catch (error) {
        if (agent.interactivePlan === pending)
          await this.replace(agent, pending, plan);
        throw error;
      }
      if (
        agent.interactivePlan !== pending ||
        agentConversationId(agent) !== plan.conversationId
      )
        throw new Error("The conversation changed while submitting feedback.");
      await this.replace(agent, pending, {
        ...plan,
        answers,
        answerVersion: plan.answerVersion + 1,
        submitted: true,
      });
    });
  }
  private async replace(
    agent: Agent,
    previous: InteractivePlan | undefined,
    next: InteractivePlan,
  ): Promise<void> {
    agent.interactivePlan = next;
    try {
      await this.options.persist();
    } catch (error) {
      if (agent.interactivePlan === next) agent.interactivePlan = previous;
      throw error;
    }
    this.options.publish();
  }
  private async lock<T>(agentId: string, run: () => Promise<T>): Promise<T> {
    if (this.busy.has(agentId))
      throw new Error("A plan operation is already in progress.");
    this.busy.add(agentId);
    try {
      return await run();
    } finally {
      this.busy.delete(agentId);
    }
  }
}
