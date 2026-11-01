import type {
  CodeReviewFinding,
  CodeReviewFindingInput,
  CodeReviewFindingUpdateInput,
} from '@workspace/core/code-review';

export type ReviewToolHandlers = {
  finishReviewRound(input: { findingCount: number }): Promise<{ roundId: string; findingCount: number }>;
  reportFinding(input: CodeReviewFindingInput): Promise<CodeReviewFinding> | CodeReviewFinding;
  updateFinding(input: CodeReviewFindingUpdateInput): Promise<CodeReviewFinding> | CodeReviewFinding;
  deleteFinding(input: { findingId: string }): Promise<{ findingId: string; deleted: true }> | { findingId: string; deleted: true };
};

export type ReviewToolContext = ReviewToolHandlers & {
  id: string;
  agentId: string;
};

export class ReviewToolRegistry {
  private readonly contexts = new Map<string, ReviewToolContext>();

  create(agentId: string, contextId: string, handlers: ReviewToolHandlers): ReviewToolContext {
    if (this.contexts.has(contextId)) throw new Error('Review context already exists.');
    const context: ReviewToolContext = {
      id: contextId,
      agentId,
      finishReviewRound: async (input) => this.run(context, () => handlers.finishReviewRound(input)),
      reportFinding: (input) => this.run(context, () => handlers.reportFinding(input)),
      updateFinding: (input) => this.run(context, () => handlers.updateFinding(input)),
      deleteFinding: (input) => this.run(context, () => handlers.deleteFinding(input)),
    };
    this.contexts.set(context.id, context);
    return context;
  }

  resolve(agentId: string, contextId: string | null): ReviewToolContext | null {
    if (!contextId) return null;
    const context = this.contexts.get(contextId);
    return context?.agentId === agentId ? context : null;
  }

  close(contextId: string): void {
    this.contexts.delete(contextId);
  }

  private run<T>(context: ReviewToolContext, action: () => Promise<T> | T): Promise<T> | T {
    if (!this.contexts.has(context.id)) throw new Error('Review context is no longer available.');
    return action();
  }
}
