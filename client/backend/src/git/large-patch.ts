import type { AgentGitDiffOmittedFile } from '@workspace/core/contracts';

/** The most changed lines (added plus removed) of one file whose patch Korus hands to the diff view. */
const largePatchLineLimit = 3000;

/**
 * Drops the hunks of every file that changed more than `limit` lines, keeping its header, and lists those files with
 * git's own line counts so the diff view can say the diff is too large to be shown. One huge generated or vendored
 * file cannot then freeze the view.
 */
export function elideLargePatches(diff: string, limit = largePatchLineLimit): { diff: string; omitted: AgentGitDiffOmittedFile[] } {
  // A changed line takes at least two characters, so a shorter patch cannot hold `limit` of them.
  if (diff.length < limit * 2) return { diff, omitted: [] };
  const omitted: AgentGitDiffOmittedFile[] = [];
  const files = diff.split(/^(?=diff --git )/m).map(file => {
    const firstHunk = file.search(/^@@ /m);
    if (firstHunk === -1) return file;
    let addedLines = 0;
    let removedLines = 0;
    for (const line of file.slice(firstHunk).split('\n')) {
      if (line.startsWith('+')) addedLines += 1;
      else if (line.startsWith('-')) removedLines += 1;
    }
    if (addedLines + removedLines <= limit) return file;
    omitted.push({ path: visiblePath(file.slice(0, firstHunk)), addedLines, removedLines });
    return file.slice(0, firstHunk);
  });
  return { diff: files.join(''), omitted };
}

/** The path the diff view lists for a file: where it is now, or where it was when it was deleted. */
function visiblePath(header: string): string {
  const after = /^\+\+\+ (?:b\/)?(.+)$/m.exec(header)?.[1];
  if (after && after !== '/dev/null') return after;
  return /^--- (?:a\/)?(.+)$/m.exec(header)?.[1] ?? '';
}
