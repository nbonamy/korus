import { addFileToKindStats, emptyKindStats, fileKinds, isLockfile, type KindBreakdown, type KindStats } from './file-kind';

export type LockfileStats = KindStats & { byKind?: KindBreakdown };

/** Optional additive metadata keeps raw Git totals compatible with existing clients. */
export function summarizeLockfiles(files: Iterable<{ path: string; addedLines: number; removedLines: number }>): LockfileStats | undefined {
  const summary: LockfileStats = { changedFiles: 0, addedLines: 0, removedLines: 0, byKind: emptyKindStats() };
  for (const file of files) {
    if (!isLockfile(file.path)) continue;
    summary.changedFiles++;
    summary.addedLines += file.addedLines;
    summary.removedLines += file.removedLines;
    addFileToKindStats(summary.byKind!, file.path, file.addedLines, file.removedLines);
  }
  return summary.changedFiles ? summary : undefined;
}

/** Display filtering never changes the status or file list used for Git operations. */
export function withoutLockfileStats<T extends KindStats & { byKind?: KindBreakdown; lockfiles?: LockfileStats }>(summary: T): T {
  const { lockfiles, ...rest } = summary;
  if (!lockfiles) return summary;
  const subtract = (total: KindStats, excluded: KindStats): KindStats => ({
    addedLines: Math.max(0, total.addedLines - excluded.addedLines),
    removedLines: Math.max(0, total.removedLines - excluded.removedLines),
    changedFiles: Math.max(0, total.changedFiles - excluded.changedFiles),
  });
  return {
    ...rest,
    ...subtract(summary, lockfiles),
    ...(summary.byKind && lockfiles.byKind ? {
      byKind: Object.fromEntries(fileKinds.map(kind => [kind, subtract(summary.byKind![kind], lockfiles.byKind![kind])])) as KindBreakdown,
    } : {}),
  } as T;
}
