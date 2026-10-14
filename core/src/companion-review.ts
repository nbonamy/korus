import type { AgentBackend } from './contracts';
import type { CompanionTarget } from './companion-protocol';
import type { CodeReviewPreferences, CodeReviewStartInput } from './code-review';

export type CompanionReviewInput = CodeReviewStartInput;
/** Review initialization only; the desktop backend owns review execution and findings. */
export type CompanionReviewSetup = {
  target: CompanionTarget;
  branch: string | null;
  baseRef: string | null;
  uncommitted: boolean;
  branchChanges: boolean;
  currentThread: boolean;
  activeReview: boolean;
  reviewerAgentId: string | null;
  agentBackend: AgentBackend;
  backend: AgentBackend;
  backends: AgentBackend[];
  models: { id: string; name: string; efforts: string[] }[];
  preferences?: CodeReviewPreferences;
};
