import type { AgentFilePreviewResult } from './contracts/workspace';

/** A transcript target, resolved by the agent's owning daemon. */
export type CompanionFileInput = { path: string; action?: 'read' | 'edit' | 'create'; turnId?: string; line?: number };
export type CompanionFilePreview = {
  path: string;
  /** Source is the current file, independently of a historical turn's patch. */
  source: AgentFilePreviewResult | null;
  diff: string | null;
  diffScope: 'turn' | 'uncommitted';
  diffUnavailable?: boolean;
};
