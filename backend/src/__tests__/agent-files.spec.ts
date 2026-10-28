import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { listAgentFolderFiles, previewAgentFolderFile, readAgentFolderFileChunk } from '../agent-files';

const execFileAsync = promisify(execFile);
const tempFolders: string[] = [];

describe('listAgentFolderFiles', () => {
  it('downloads binary files beyond the preview limit in bounded, byte-exact chunks', async () => {
    const folder = await createTempFolder();
    const original = Buffer.alloc(2 * 1024 * 1024 + 7, 0x9a);
    await writeFile(path.join(folder, 'film.mp4'), original);
    expect((await previewAgentFolderFile(folder, 'film.mp4')).kind).toBe('tooLarge');
    const parts: Buffer[] = [];
    let offset = 0;
    while (offset < original.length) {
      const result = await readAgentFolderFileChunk(folder, 'film.mp4', offset);
      const bytes = Buffer.from(result.data, 'base64');
      expect(bytes.length).toBeLessThanOrEqual(512 * 1024);
      expect(result.size).toBe(original.length);
      expect(result.nextOffset).toBe(offset + bytes.length);
      parts.push(bytes);
      offset = result.nextOffset;
    }
    expect(Buffer.concat(parts).equals(original)).toBe(true);
    await expect(readAgentFolderFileChunk(folder, 'film.mp4', -1)).rejects.toThrow('Invalid file offset');
    await expect(readAgentFolderFileChunk(folder, 'film.mp4', original.length + 1)).rejects.toThrow('File changed');
    await expect(readAgentFolderFileChunk(folder, '.', 0)).rejects.toThrow('not a file');
  });

  afterEach(async () => {
    await Promise.all(tempFolders.map(async (folder) => {
      await rm(folder, { recursive: true, force: true });
    }));
    tempFolders.length = 0;
  });

  it('returns sorted relative file paths from an agent folder', async () => {
    const folder = await createTempFolder();
    await mkdir(path.join(folder, 'src'), { recursive: true });
    await writeFile(path.join(folder, 'README.md'), 'hello');
    await writeFile(path.join(folder, 'src', 'main.ts'), 'main');

    await expect(listAgentFolderFiles(folder)).resolves.toStrictEqual([
      { name: 'README.md', path: 'README.md' },
      { name: 'main.ts', path: 'src/main.ts' },
    ]);
  });

  it('skips generated folders and symbolic links', async () => {
    const folder = await createTempFolder();
    await mkdir(path.join(folder, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(folder, '.git'), { recursive: true });
    await writeFile(path.join(folder, 'node_modules', 'pkg', 'index.js'), 'ignored');
    await writeFile(path.join(folder, '.git', 'config'), 'ignored');
    await writeFile(path.join(folder, 'package.json'), '{}');
    await symlink(path.join(folder, 'package.json'), path.join(folder, 'package-link.json'));

    await expect(listAgentFolderFiles(folder)).resolves.toStrictEqual([
      { name: 'package.json', path: 'package.json' },
    ]);
  });

  describe('in a Git repository', () => {
    const git = (folder: string, ...args: string[]) => execFileAsync('git', args, { cwd: folder });

    it('lists tracked and untracked files but not ignored ones, so ignored folders cannot use up the budget', async () => {
      const folder = await createTempFolder();
      await git(folder, 'init', '-q');
      await writeFile(path.join(folder, '.gitignore'), '.scratch/\n');
      await mkdir(path.join(folder, '.scratch'), { recursive: true });
      for (const name of ['a', 'b', 'c', 'd', 'e']) await writeFile(path.join(folder, '.scratch', `${name}.json`), '{}');
      await mkdir(path.join(folder, 'src', 'pricing'), { recursive: true });
      await writeFile(path.join(folder, 'src', 'pricing', 'history.json'), '{}');
      await writeFile(path.join(folder, 'src', 'notes.md'), 'untracked');
      await git(folder, 'add', '.gitignore', 'src/pricing/history.json');

      await expect(listAgentFolderFiles(folder, { maxFiles: 3 })).resolves.toStrictEqual([
        { name: '.gitignore', path: '.gitignore' },
        { name: 'notes.md', path: 'src/notes.md' },
        { name: 'history.json', path: 'src/pricing/history.json' },
      ]);
    });

    it('walks the disk when Git lists nothing, such as a folder the parent repository ignores', async () => {
      const parent = await createTempFolder();
      await git(parent, 'init', '-q');
      await writeFile(path.join(parent, '.gitignore'), 'inner/\n');
      await mkdir(path.join(parent, 'inner'), { recursive: true });
      await writeFile(path.join(parent, 'inner', 'file.txt'), 'x');

      await expect(listAgentFolderFiles(path.join(parent, 'inner'))).resolves.toStrictEqual([{ name: 'file.txt', path: 'file.txt' }]);
    });

    it('leaves out tracked files that were deleted, symbolic links and generated folders', async () => {
      const folder = await createTempFolder();
      await git(folder, 'init', '-q');
      await mkdir(path.join(folder, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(path.join(folder, 'node_modules', 'pkg', 'index.js'), 'tracked anyway');
      await writeFile(path.join(folder, 'gone.txt'), 'x');
      await writeFile(path.join(folder, 'package.json'), '{}');
      await symlink(path.join(folder, 'package.json'), path.join(folder, 'package-link.json'));
      await git(folder, 'add', '-f', '.');
      await rm(path.join(folder, 'gone.txt'));

      await expect(listAgentFolderFiles(folder)).resolves.toStrictEqual([{ name: 'package.json', path: 'package.json' }]);
    });
  });

  it('honors max file limits', async () => {
    const folder = await createTempFolder();
    await writeFile(path.join(folder, 'a.txt'), 'a');
    await writeFile(path.join(folder, 'b.txt'), 'b');

    await expect(listAgentFolderFiles(folder, { maxFiles: 1 })).resolves.toHaveLength(1);
  });

  it('reads text files inside an agent folder', async () => {
    const folder = await createTempFolder();
    await writeFile(path.join(folder, 'README.md'), '# Read me\n', 'utf8');

    await expect(previewAgentFolderFile(folder, 'README.md')).resolves.toStrictEqual({
      path: 'README.md',
      size: 10,
      kind: 'text',
      content: '# Read me\n',
    });
  });

  it('reads absolute files, traversal paths, and symlinks outside the agent folder', async () => {
    const folder = await createTempFolder();
    const outsideFolder = await createTempFolder();
    const outsideFile = path.join(outsideFolder, 'notes.md');
    const content = '# External notes\n';
    await writeFile(outsideFile, content, 'utf8');

    await symlink(outsideFile, path.join(folder, 'notes-link.md'));
    await expect(previewAgentFolderFile(folder, outsideFile)).resolves.toStrictEqual({
      path: outsideFile,
      size: Buffer.byteLength(content),
      kind: 'text',
      content,
    });
    const traversalPath = path.relative(folder, outsideFile);
    await expect(previewAgentFolderFile(folder, traversalPath)).resolves.toMatchObject({
      path: traversalPath.split(path.sep).join('/'),
      content,
    });
    await expect(previewAgentFolderFile(folder, 'notes-link.md')).resolves.toMatchObject({
      path: 'notes-link.md',
      content,
    });
  });

  it('rejects folders and reports oversized files before reading content', async () => {
    const folder = await createTempFolder();
    await writeFile(path.join(folder, 'large.md'), 'xxxx', 'utf8');

    await expect(previewAgentFolderFile(folder, '.')).rejects.toThrow('Path is not a file');
    await expect(previewAgentFolderFile(folder, 'large.md', { maxBytes: 3 })).resolves.toStrictEqual({
      path: 'large.md', size: 4, kind: 'tooLarge',
    });
  });

  it('classifies binary and image previews without decoding them as text', async () => {
    const folder = await createTempFolder();
    await writeFile(path.join(folder, 'archive.bin'), Buffer.from([1, 0, 2]));
    await writeFile(path.join(folder, 'pixel.png'), Buffer.from([1, 2, 3]));

    await expect(previewAgentFolderFile(folder, 'archive.bin')).resolves.toStrictEqual({
      path: 'archive.bin', size: 3, kind: 'binary',
    });
    await expect(previewAgentFolderFile(folder, 'pixel.png')).resolves.toStrictEqual({
      path: 'pixel.png', size: 3, kind: 'image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID',
    });
  });
});

async function createTempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'agent-workspace-agent-files-'));
  tempFolders.push(folder);
  return folder;
}
