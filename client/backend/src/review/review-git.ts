import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CodeReviewScope } from '@workspace/core/code-review';

const execute = promisify(execFile);

export type ReviewGitSnapshot = { head: string; fingerprint: string; branch: string };
export type ReviewGitPort = {
  prepare(folder: string, scope: CodeReviewScope): Promise<ReviewGitSnapshot & { baseRef: string }>;
  inspect(folder: string): Promise<ReviewGitSnapshot>;
  hasChanges(folder: string): Promise<boolean>;
  commit(folder: string, expected: ReviewGitSnapshot, round: number): Promise<ReviewGitSnapshot & { commit?: string }>;
};

/** Git mutations stay on the owning host; no pushes, resets, or hook bypasses. */
export class ReviewGit implements ReviewGitPort {
  async prepare(folder: string, scope: CodeReviewScope) {
    const root = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
    if (await realpath(root) !== await realpath(folder)) {
      throw new Error('Automatic review requires the repository root as the agent folder.');
    }
    const snapshot = await this.inspect(folder);
    let baseRef = scope.type === 'branch'
      ? (await git(folder, ['merge-base', 'HEAD', '--', scope.baseRef])).trim()
      : snapshot.head;
    if (scope.type === 'commit') {
      const [, parent] = (await git(folder, ['rev-list', '--parents', '-n', '1', scope.sha, '--'])).trim().split(/\s+/);
      baseRef = parent ?? (await git(folder, ['hash-object', '-w', '-t', 'tree', process.platform === 'win32' ? 'NUL' : '/dev/null'])).trim();
    }
    return { ...snapshot, baseRef };
  }

  async inspect(folder: string): Promise<ReviewGitSnapshot> {
    const head = (await git(folder, ['rev-parse', '--verify', 'HEAD'])).trim();
    const branch = (await git(folder, ['symbolic-ref', '--quiet', 'HEAD']).catch(() => '')).trim();
    if (!branch) throw new Error('Automatic review requires a checked-out branch. Switch from the detached HEAD before continuing.');
    const status = await git(folder, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if ((await git(folder, ['diff', '--name-only', '--diff-filter=U', '-z'])).length) {
      throw new Error('Resolve merge conflicts before continuing automatic review.');
    }
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
      const markerPath = (await git(folder, ['rev-parse', '--git-path', marker])).trim();
      if (await lstat(path.resolve(folder, markerPath)).then(() => true, () => false)) {
        throw new Error('Finish the current Git operation before continuing automatic review.');
      }
    }
    const hash = createHash('sha256').update(head).update(branch).update(status);
    hash.update(await git(folder, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']));
    hash.update(await git(folder, ['diff', '--no-ext-diff', '--no-textconv', '--cached', '--binary', '--']));
    for (const name of await untracked(folder)) {
      const file = path.join(folder, name);
      const info = await lstat(file);
      hash.update(name).update(String(info.mode));
      if (info.isSymbolicLink()) hash.update(await readlink(file));
      else for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
    return { head, branch, fingerprint: hash.digest('hex') };
  }

  async hasChanges(folder: string): Promise<boolean> {
    return (await git(folder, ['status', '--porcelain=v1', '--untracked-files=all'])).trim().length > 0;
  }

  async commit(folder: string, expected: ReviewGitSnapshot, round: number): Promise<ReviewGitSnapshot & { commit?: string }> {
    const actual = await this.inspect(folder);
    if (actual.head !== expected.head || actual.branch !== expected.branch || actual.fingerprint !== expected.fingerprint) {
      throw new Error('The workspace changed before the review commit. Inspect it before continuing.');
    }
    const files = [...new Set([
      ...(await git(folder, ['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--'])).split('\0').filter(Boolean),
      ...await untracked(folder),
    ])];
    if (files.length === 0) return actual;
    // The setup explicitly authorizes committing the reviewed working changes and
    // their fixes. Literal paths also handle renames, deletions and unusual names.
    await git(folder, ['add', '--all', '--', ...files]);
    await git(folder, ['commit', '--only', '-m', `fix: address review round ${round}`, '--', ...files]);
    const result = await this.inspect(folder);
    return { ...result, commit: result.head };
  }
}

async function untracked(folder: string): Promise<string[]> {
  // Git lists an embedded repository as a trailing-slash directory; it is neither hashed nor committed.
  return (await git(folder, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(name => name && !name.endsWith('/'));
}

async function git(folder: string, args: string[]): Promise<string> {
  const result = await execute('git', ['--literal-pathspecs', ...args], {
    cwd: folder, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}
