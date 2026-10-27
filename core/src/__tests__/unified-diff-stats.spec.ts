import { describe, expect, it } from 'vitest';
import { summarizeUnifiedDiff } from '../unified-diff-stats';

const file = (path: string, lines: string[]) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@', ...lines].join('\n');

describe('summarizeUnifiedDiff', () => {
  it('counts lines and files and splits them by what each file is for', () => {
    const summary = summarizeUnifiedDiff([
      file('src/app.ts', ['-old', '+new', '+more']),
      file('src/app.test.ts', ['+it()']),
      file('docs/guide.md', ['+text', '-text']),
    ].join('\n'));
    expect(summary).toMatchObject({ addedLines: 4, removedLines: 2, changedFiles: 3 });
    expect(summary.byKind).toStrictEqual({
      code: { addedLines: 2, removedLines: 1, changedFiles: 1 },
      test: { addedLines: 1, removedLines: 0, changedFiles: 1 },
      docs: { addedLines: 1, removedLines: 1, changedFiles: 1 },
      other: { addedLines: 0, removedLines: 0, changedFiles: 0 },
    });
  });

  it('merges a file that appears in several sections and keeps paths with spaces', () => {
    const summary = summarizeUnifiedDiff([file('src/a b.ts', ['+one']), file('src/a b.ts', ['+two'])].join('\n'));
    expect(summary.changedFiles).toBe(1);
    expect(summary.byKind.code).toStrictEqual({ addedLines: 2, removedLines: 0, changedFiles: 1 });
  });

  it('has nothing to report for text that is not a diff', () => {
    expect(summarizeUnifiedDiff('turn diff')).toMatchObject({ addedLines: 0, removedLines: 0, changedFiles: 0 });
  });
});
