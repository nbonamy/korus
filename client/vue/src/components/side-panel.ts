import type { AgentGitDiffSection } from '@workspace/core/contracts';

export type SidePanelBaseState = {
  documentId?: string;
  path?: string;
  savedPath?: string;
  title: string;
  subtitle?: string;
  state: 'idle' | 'loading' | 'error';
  error?: string | null;
};

export type SidePanelMarkdownState = SidePanelBaseState & {
  kind: 'markdown';
  purpose?: 'plan';
  content: string;
};

export type SidePanelSourceState = SidePanelBaseState & {
  kind: 'source';
  content: string;
  language?: string | null;
};

export type SidePanelImageState = SidePanelBaseState & {
  kind: 'image';
  alt: string;
  mimeType?: string;
  path?: string;
  src: string;
};

export type SidePanelGitDiffState = SidePanelBaseState & {
  kind: 'gitDiff';
  target?: import('@workspace/core/contracts').AgentGitDiffTarget;
  summary?: import('@workspace/core/contracts').AgentGitDiffSummary;
  diff: string;
  /** Files whose patch was left out as too large; the diff keeps only their headers. */
  omittedFiles?: import('@workspace/core/contracts').AgentGitDiffOmittedFile[];
  sections?: AgentGitDiffSection[];
  /** Set when the diff was opened from a file type row: that group alone starts expanded. */
  focusKind?: import('@workspace/core/file-kind').FileKind;
  focusSequence?: number;
};

export type PlanReviewComment = {
  id: string;
  quote: string;
  body: string;
};
