import { describe, expect, it } from 'vitest';
import { withoutLockfileStats } from '../diff-lockfiles';
import { summarizeUnifiedDiff } from '../unified-diff-stats';

const file = (path: string, lines: string[]) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@', ...lines].join('\n');

describe('summarizeUnifiedDiff', () => {
  it('reports dependency lockfile contributions separately without changing the unfiltered totals', () => {
    const locks = ['package-lock.json', 'nested/pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum', 'Package.resolved', 'pubspec.lock', '.terraform.lock.hcl', 'gradle/dependency-locks/runtime.lockfile'];
    const summary = summarizeUnifiedDiff([
      ...locks.map(path => file(path, ['+generated', '-generated'])),
      file('package.json', ['+manifest']), file('src/important.lock.ts', ['+source']),
    ].join('\n'));
    expect(summary).toMatchObject({ changedFiles: locks.length + 2, addedLines: locks.length + 2, removedLines: locks.length });
    expect(summary.lockfiles).toMatchObject({ changedFiles: locks.length, addedLines: locks.length, removedLines: locks.length });
    const filtered = withoutLockfileStats(summary);
    expect(filtered).toMatchObject({ changedFiles: 2, addedLines: 2, removedLines: 0 });
    expect(filtered.byKind.other).toMatchObject({ changedFiles: 1, addedLines: 1, removedLines: 0 });
    expect(filtered.byKind.code.changedFiles).toBe(1);
    expect(withoutLockfileStats(filtered)).toEqual(filtered);
    expect(summary.changedFiles).toBe(locks.length + 2);
  });
  it('counts binary lockfiles and quoted paths even without text hunks', () => {
    const summary = summarizeUnifiedDiff('diff --git "a/nested folder/bun.lockb" "b/nested folder/bun.lockb"\nBinary files differ');
    expect(withoutLockfileStats(summary)).toMatchObject({ changedFiles: 0, addedLines: 0, removedLines: 0 });
  });
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
