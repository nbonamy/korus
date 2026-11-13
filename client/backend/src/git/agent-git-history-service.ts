import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentGitLogCommit, AgentGitLogCommitInput, AgentGitLogDetails, AgentGitLogFile, AgentGitLogFileDiff, AgentGitLogFileInput, AgentGitLogInput, AgentGitLogPage } from '@workspace/core/contracts';

const exec = promisify(execFile);
const format = '%H%x00%s%x00%an%x00%aI';
// A list record starts at a marker byte so the shortstat text that follows it stays with its commit.
const listFormat = '%x01%H%x00%s%x00%an%x00%aI%x00';
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const maxFiles = 500;

/** Read-only history, pinned to the owning worktree's HEAD. Git output and time are bounded. */
export class AgentGitHistoryService {
  private async git(folder: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
    const { stdout } = await exec('git', ['--no-pager', ...args], {
      cwd: folder, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', ...env },
    });
    return stdout;
  }

  async list(folder: string, input: AgentGitLogInput = {}): Promise<AgentGitLogPage> {
    if (!input || typeof input !== 'object') throw new Error('Invalid history request.');
    const limit = input.limit ?? 50;
    const search = input.search ?? '';
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid history limit.');
    if (typeof search !== 'string' || search.length > 200 || search.includes('\0')) throw new Error('Invalid history search.');
    const offset = input.cursor?.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error('Invalid history cursor.');
    const [root, branch, head, commonDirectory] = await Promise.all([
      this.git(folder, ['rev-parse', '--show-toplevel']),
      this.git(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
      this.git(folder, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => ''),
      this.git(folder, ['rev-parse', '--git-common-dir']),
    ]);
    const scope = { repository: basename(dirname(resolve(root.trim(), commonDirectory.trim()))), branch: branch.trim() || null, head: head.trim() || null };
    if (input.cursor) {
      if (input.cursor.head !== scope.head || input.cursor.search !== search) throw new Error('Git history changed. Refresh the log.');
      this.requireSha(input.cursor.head);
    }
    if (!scope.head) return { ...scope, commits: [] };
    const grep = search ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${search}`] : [];
    const log = (withStats: boolean) => this.git(folder, ['log', '--no-show-signature', '--date-order', `--max-count=${limit + 1}`, `--skip=${offset}`, ...(withStats ? ['--shortstat'] : []), `--format=${listFormat}`, ...grep, scope.head!, '--'],
      // The shortstat summary is English text, so the locale is pinned.
      withStats ? { LC_ALL: 'C', LANGUAGE: 'C' } : {});
    // Line counts ride on the same git call as the list; if counting fails, the list is still returned without them.
    const raw = await log(true).catch(() => log(false));
    const commits: AgentGitLogCommit[] = [];
    for (const record of raw.split('\u0001').slice(1)) {
      const [sha, subject, author, date, tail = ''] = record.split('\0');
      const summary = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/u.exec(tail);
      commits.push({ sha: sha!, subject: subject!, author: author!, date: date!,
        ...(summary ? { stats: { files: Number(summary[1]), additions: Number(summary[2] ?? 0), deletions: Number(summary[3] ?? 0) } } : {}) });
    }
    const page = commits.slice(0, limit);
    return { ...scope, commits: page, ...(commits.length > limit ? { nextCursor: { head: scope.head, offset: offset + limit, search } } : {}) };
  }

  private requireSha(sha: unknown): asserts sha is string {
    if (typeof sha !== 'string' || !shaPattern.test(sha)) throw new Error('Invalid commit identity.');
  }

  private async assertSelection(folder: string, input: AgentGitLogCommitInput): Promise<void> {
    this.requireSha(input?.head);
    this.requireSha(input?.sha);
    if ((await this.git(folder, ['rev-parse', '--verify', 'HEAD'])).trim() !== input.head) throw new Error('Git history changed. Refresh the log.');
    await this.git(folder, ['merge-base', '--is-ancestor', input.sha, input.head]).catch(() => { throw new Error('Commit is outside this history.'); });
  }

  private async files(folder: string, sha: string): Promise<AgentGitLogFile[]> {
    const args = ['diff-tree', '--root', '--no-commit-id', '-r', '--first-parent', '-m', '-M', '--no-ext-diff', '--no-textconv'];
    // Explicit first-parent comparison also gives merge commits useful file details.
    const parents = (await this.git(folder, ['rev-list', '--parents', '-n', '1', sha])).trim().split(' ');
    const comparison = parents[1] ? [parents[1], sha] : [sha];
    const [names, stats] = await Promise.all([
      this.git(folder, [...args, '--name-status', '-z', ...comparison, '--']),
      this.git(folder, [...args, '--numstat', '-z', ...comparison, '--']),
    ]);
    const counts = new Map<string, Pick<AgentGitLogFile, 'addedLines' | 'removedLines' | 'binary'>>();
    const values = stats.split('\0');
    for (let i = 0; i < values.length && values[i]; i++) {
      const value = values[i]!;
      const first = value.indexOf('\t');
      const second = value.indexOf('\t', first + 1);
      const added = value.slice(0, first);
      const removed = value.slice(first + 1, second);
      let path = value.slice(second + 1);
      if (!path) { i++; path = values[++i]!; }
      counts.set(path, { addedLines: added === '-' ? null : Number(added), removedLines: removed === '-' ? null : Number(removed), binary: added === '-' });
    }
    const tokens = names.split('\0');
    const files: AgentGitLogFile[] = [];
    for (let i = 0; i < tokens.length && tokens[i];) {
      const status = tokens[i++]!.charAt(0);
      const firstPath = tokens[i++]!;
      const previousPath = status === 'R' || status === 'C' ? firstPath : undefined;
      const path = previousPath ? tokens[i++]! : firstPath;
      files.push({ path, ...(previousPath ? { previousPath } : {}), status, ...(counts.get(path) ?? { addedLines: 0, removedLines: 0, binary: false }) });
    }
    return files;
  }

  async commit(folder: string, input: AgentGitLogCommitInput): Promise<AgentGitLogDetails> {
    await this.assertSelection(folder, input);
    const [raw, files] = await Promise.all([
      this.git(folder, ['show', '--no-show-signature', '-s', `--format=${format}%x00%B`, input.sha, '--']),
      this.files(folder, input.sha),
    ]);
    const [sha, subject, author, date, message] = raw.split('\0');
    return { sha: sha!, subject: subject!, author: author!, date: date!, message: message!.trimEnd(), files: files.slice(0, maxFiles), filesTruncated: files.length > maxFiles };
  }

  async file(folder: string, input: AgentGitLogFileInput): Promise<AgentGitLogFileDiff> {
    await this.assertSelection(folder, input);
    if (typeof input.path !== 'string') throw new Error('Invalid history file.');
    const file = (await this.files(folder, input.sha)).slice(0, maxFiles).find(file => file.path === input.path);
    if (!file) throw new Error('File is outside this commit.');
    const parents = (await this.git(folder, ['rev-list', '--parents', '-n', '1', input.sha])).trim().split(' ');
    const paths = [...(file.previousPath ? [file.previousPath] : []), file.path].map(path => `:(literal)${path}`);
    const common = ['--no-ext-diff', '--no-textconv', '--no-color', '-M'];
    const diff = await this.git(folder, parents[1]
      ? ['diff', ...common, parents[1], input.sha, '--', ...paths]
      : ['show', '--no-show-signature', '--format=', ...common, input.sha, '--', ...paths]);
    return { diff };
  }
}
