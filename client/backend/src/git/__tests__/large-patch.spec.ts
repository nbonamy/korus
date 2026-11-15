import { describe, expect, it } from 'vitest';
import { elideLargePatches } from '../large-patch';

const added = (path: string, lines: number) => [
  `diff --git a/${path} b/${path}`, 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', `+++ b/${path}`,
  `@@ -0,0 +1,${lines} @@`, ...Array.from({ length: lines }, (_, index) => `+line ${index}`), '',
].join('\n');
const modified = (path: string) => [
  `diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
  '@@ -1,2 +1,2 @@', ' same', '-old', '+new', '',
].join('\n');

describe('eliding large file patches', () => {
  it('keeps every patch of a diff whose files are all within the limit', () => {
    const diff = modified('a.ts') + added('b.ts', 50);
    expect(elideLargePatches(diff, 100)).toStrictEqual({ diff, omitted: [] });
  });

  it('keeps only the header of an oversized file patch and lists it with its real counts, leaving the others untouched', () => {
    const diff = modified('a.ts') + added('huge.txt', 120) + modified('c.ts');

    expect(elideLargePatches(diff, 100)).toStrictEqual({
      diff: modified('a.ts')
        + ['diff --git a/huge.txt b/huge.txt', 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', '+++ b/huge.txt', ''].join('\n')
        + modified('c.ts'),
      omitted: [{ path: 'huge.txt', addedLines: 120, removedLines: 0 }],
    });
  });

  it('counts added and removed lines separately, lists a deleted file by its old path, and leaves binary patches alone', () => {
    const edited = [
      'diff --git a/x b/x', 'index 1..2 100644', '--- a/x', '+++ b/x', '@@ -1,60 +1,60 @@',
      ...Array.from({ length: 60 }, (_, index) => `-old ${index}`), ...Array.from({ length: 60 }, (_, index) => `+new ${index}`), '',
    ].join('\n');
    const deleted = [
      'diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', 'index 1..0000000', '--- a/gone.txt', '+++ /dev/null', '@@ -1,150 +0,0 @@',
      ...Array.from({ length: 150 }, (_, index) => `-old ${index}`), '',
    ].join('\n');
    const binary = 'diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n';

    const result = elideLargePatches(edited + deleted + binary, 100);

    expect(result.omitted).toStrictEqual([
      { path: 'x', addedLines: 60, removedLines: 60 },
      { path: 'gone.txt', addedLines: 0, removedLines: 150 },
    ]);
    expect(result.diff).not.toContain('@@');
    expect(result.diff).toContain(binary);
  });
});
