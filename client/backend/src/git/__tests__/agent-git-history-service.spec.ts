import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentGitHistoryService } from '../agent-git-history-service';

const exec = promisify(execFile);
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'korus-history-'));
  folders.push(folder);
  const git = async (...args: string[]) => (await exec('git', args, { cwd: folder })).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'History Author');
  await git('config', 'user.email', 'history@example.test');
  const commit = async (message: string, file = 'file.txt', content = message) => {
    await writeFile(join(folder, file), content);
    await git('add', '--', file);
    await git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { folder, git, commit, history: new AgentGitHistoryService() };
}

describe('branch-scoped Git history', () => {
  it('pages a stable branch history, searches full messages literally, and excludes other branches', async () => {
    const { folder, git, commit, history } = await fixture();
    const root = await commit('root');
    await git('checkout', '-b', 'other');
    await commit('other branch only');
    await git('checkout', 'main');
    await commit('first\n\nLiteral [needle] body');
    const head = await commit('second');
    const first = await history.list(folder, { limit: 2 });
    expect(first.branch).toBe('main');
    expect(first.head).toBe(head);
    expect(first.commits.map(c => c.subject)).toStrictEqual(['second', 'first']);
    const older = await history.list(folder, { limit: 2, cursor: first.nextCursor });
    expect(older.commits.map(c => c.sha)).toStrictEqual([root]);
    expect(older.nextCursor).toBeUndefined();
    expect((await history.list(folder, { search: '[NEEDLE]' })).commits.map(c => c.subject)).toStrictEqual(['first']);
    await commit('new head');
    await expect(history.list(folder, { cursor: first.nextCursor })).rejects.toThrow(/changed/i);
  });

  it('returns root and first-parent merge changes, binary statistics, exact unusual paths, and bounded file diffs', async () => {
    const { folder, git, commit, history } = await fixture();
    const path = 'tab\tline\nfile.txt';
    const root = await commit('root\n\nFull message', path, 'before\n');
    const details = await history.commit(folder, { head: root, sha: root });
    expect(details.message).toBe('root\n\nFull message');
    expect(details.files).toStrictEqual([{ path, status: 'A', addedLines: 1, removedLines: 0, binary: false }]);
    expect((await history.file(folder, { head: root, sha: root, path })).diff).toContain('+before');
    await git('checkout', '-b', 'side');
    await commit('side addition', 'binary.bin', '\0binary');
    await git('checkout', 'main');
    await commit('main change', path, 'after\n');
    await git('merge', '--no-ff', '-m', 'merge side', 'side');
    const head = await git('rev-parse', 'HEAD');
    expect((await history.commit(folder, { head, sha: head })).files).toStrictEqual([{ path: 'binary.bin', status: 'A', addedLines: null, removedLines: null, binary: true }]);
    await expect(history.file(folder, { head, sha: head, path: '../outside' })).rejects.toThrow(/file/i);
    await expect(history.list(folder, { limit: 10000 })).rejects.toThrow(/limit/i);
    await expect(history.commit(folder, { head, sha: '--all' })).rejects.toThrow(/commit/i);
  });

  it('handles unborn and detached HEAD and rejects commits outside the selected history', async () => {
    const { folder, git, commit, history } = await fixture();
    expect((await history.list(folder)).commits).toStrictEqual([]);
    const root = await commit('root');
    await git('checkout', '-b', 'other');
    const unrelated = await commit('other');
    await git('checkout', '--detach', root);
    const page = await history.list(folder);
    expect(page.branch).toBeNull();
    await expect(history.commit(folder, { head: root, sha: unrelated })).rejects.toThrow(/history/i);
    await git('checkout', 'main');
    await git('mv', 'file.txt', 'renamed.txt');
    await git('commit', '-m', 'rename');
    const head = await git('rev-parse', 'HEAD');
    expect((await history.commit(folder, { head, sha: head })).files).toStrictEqual([{ path: 'renamed.txt', previousPath: 'file.txt', status: 'R', addedLines: 0, removedLines: 0, binary: false }]);
    expect((await history.file(folder, { head, sha: head, path: 'renamed.txt' })).diff).toContain('rename from file.txt');
  });
  it('discloses catalog truncation and rejects oversized patches instead of returning partial content', async () => {
    const { folder, git, commit, history } = await fixture();
    const root = await commit('large patch', 'large.txt', 'x'.repeat(3 * 1024 * 1024));
    expect((await history.commit(folder, { head: root, sha: root })).files[0]?.path).toBe('large.txt');
    await expect(history.file(folder, { head: root, sha: root, path: 'large.txt' })).rejects.toThrow(/maxBuffer/i);
    await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(join(folder, `file-${i}.txt`), 'line\n')));
    await git('add', '--all'); await git('commit', '-m', 'large catalog');
    const head = await git('rev-parse', 'HEAD');
    const details = await history.commit(folder, { head, sha: head });
    expect(details.files).toHaveLength(500);
    expect(details.filesTruncated).toBe(true);
  });

  it('names the primary repository while reading only the linked worktree branch', async () => {
    const { folder, git, commit, history } = await fixture();
    const root = await commit('root');
    const linked = join(folder, 'linked-worktree');
    await git('worktree', 'add', '-b', 'linked', linked);
    const page = await history.list(linked);
    expect(page.repository).toBe(basename(folder));
    expect(page.branch).toBe('linked');
    expect(page.commits.map(commit => commit.sha)).toStrictEqual([root]);
  });

});
