import type { FileKind } from '@workspace/core/file-kind';

/** Independent categorical tints; additions and removals keep their green/red accents. */
export const diffTreemapColor: Record<FileKind, string> = {
  code: 'var(--chart-1)',
  test: 'var(--color-attention)',
  docs: 'var(--chart-3)',
  other: 'var(--color-text-muted)',
};

export type TreemapRect = { x: number; y: number; width: number; height: number };
export type TreemapLayout = {
  size: { width: number; height: number };
  tiles: { file: import('./diff-treemap-files').MapFile; rect: TreemapRect }[];
};
