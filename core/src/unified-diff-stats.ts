import { addFileToKindStats, emptyKindStats, type KindBreakdown } from './file-kind';

export type UnifiedDiffStats = { addedLines: number; removedLines: number; changedFiles: number; byKind: KindBreakdown };

/** Counts a unified diff's lines per file and groups the files by what they are for. */
export function summarizeUnifiedDiff(diff: string): UnifiedDiffStats {
  let addedLines = 0;
  let removedLines = 0;
  const files = new Map<string, { path: string; added: number; removed: number }>();
  let current: { path: string; added: number; removed: number } | undefined;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      // The new path follows the last " b/", so paths containing spaces keep their own name.
      current = files.get(line) ?? { path: line.slice(line.lastIndexOf(' b/') + 3), added: 0, removed: 0 };
      files.set(line, current);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines += 1;
      if (current) current.added += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines += 1;
      if (current) current.removed += 1;
    }
  }
  const byKind = emptyKindStats();
  for (const file of files.values()) addFileToKindStats(byKind, file.path, file.added, file.removed);
  return { addedLines, removedLines, changedFiles: files.size, byKind };
}
