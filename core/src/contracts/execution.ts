import type { AgentBackend, ReasoningEffort } from './shared';

/** A complete execution choice. Null means the provider default, including Standard tier. */
export type ExecutionSelection = Readonly<{
  backend: AgentBackend;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: string | null;
}>;

/** Only request/admission boundaries accept overrides; running work carries the resolved selection. */
export type ExecutionSelectionOverrides = Partial<ExecutionSelection>;
