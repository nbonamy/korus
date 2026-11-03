import { summarizeLockfiles, type LockfileStats } from './diff-lockfiles';
import { addFileToKindStats, emptyKindStats, type KindBreakdown } from './file-kind';

export type UnifiedDiffStats = { addedLines: number; removedLines: number; changedFiles: number; byKind: KindBreakdown; lockfiles?: LockfileStats };

/** Counts a unified diff's lines per file and groups the files by what they are for. */
export function summarizeUnifiedDiff(diff: string): UnifiedDiffStats {
  let addedLines = 0;
  let removedLines = 0;
  const files = new Map<string, { path: string; added: number; removed: number }>();
  let current: { path: string; added: number; removed: number } | undefined;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      // Git quotes paths with special characters, including binary files without +++ headers.
      const path = / (?:"b\/(.*)"|b\/(.*))$/u.exec(line);
      current = files.get(line) ?? { path: path?.[1] ?? path?.[2] ?? '', added: 0, removed: 0 };
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
  const lockfiles = summarizeLockfiles(Array.from(files.values(), file => ({ path: file.path, addedLines: file.added, removedLines: file.removed })));
  return { addedLines, removedLines, changedFiles: files.size, byKind, ...(lockfiles ? { lockfiles } : {}) };
}
