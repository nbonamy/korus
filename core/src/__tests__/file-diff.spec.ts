import { expect, it } from 'vitest';
import { changedFilePaths, diffForPath } from '../file-diff';

it('keeps navigation on changed destination paths, including quoted UTF-8, spaces and deletions', () => {
  const headers = [
    'diff --git a/old.ts b/new.ts',
    'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
    'diff --git a/a b.ts b/a b.ts',
    'diff --git a/deleted.ts b/deleted.ts',
    'diff --git a/old.ts b/new.ts',
  ];
  const diff = headers.join('\n');
  expect(changedFilePaths(diff)).toStrictEqual(['new.ts', 'café.ts', 'a b.ts', 'deleted.ts']);
  for (const path of changedFilePaths(diff)) expect(diffForPath(diff, path)).not.toBeNull();
  expect(changedFilePaths('not a patch')).toStrictEqual([]);
});
