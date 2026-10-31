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
  models: { id: string; name: string; efforts: string[]; tiers?: { id: string; name: string }[] }[];
  preferences?: CodeReviewPreferences;
};

/** Review ledger for mobile; provider sessions and host filesystem paths stay on the laptop. */
export type CompanionCodeReview = Pick<import('./code-review').CodeReviewSession,
  'id' | 'targetAgentId' | 'reviewerAgentId' | 'status' | 'activeRoundId' | 'updatedAt'> & {
  busy: boolean;
  automation?: { state: 'running' | 'paused' | 'completed' | 'manual'; reason?: string };
  rounds: Omit<import('./code-review').CodeReviewRound, 'reviewerSession'>[];
};
export type CompanionReviewDetails = { target: CompanionTarget; session: CompanionCodeReview | null };
export type CompanionReviewAction = { sessionId: string; roundId: string; updatedAt: string } & (
  | { action: 'decide'; findingId: string; selected: boolean }
  | { action: 'discuss'; findingId: string; question: string }
  | { action: 'submit' | 'again' | 'finish' | 'manual' | 'discard' }
);
