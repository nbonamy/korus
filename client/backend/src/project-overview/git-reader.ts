import { execFile } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const day = 86_400_000;
const maxCommits = 20_000;
const maxBranches = 12;
const maxFiles = 2_000;
const activeBranchAge = 30 * day;
const maxRefs = 2_000;
const maxMessages = 500;
const maxGuide = 2_000;
const guideFiles = ['AGENTS.md', 'CLAUDE.md'];

type ProjectOverviewGitCommit = { at: number; subject: string; merge: boolean };
type ProjectOverviewGitBranch = {
  name: string;
  /** The first commit this branch has that the base does not. */
  firstCommitAt: number;
  lastCommitAt: number;
  behind: number;
  ahead: number;
  files: string[];
  insertions: number;
  deletions: number;
};
export type ProjectOverviewGitFacts = {
  name: string;
  branch: string | null;
  baseBranch: string | null;
  /** History of the base branch, newest first, bounded but not windowed: the reader of these facts chooses how far back to look. */
  commits: ProjectOverviewGitCommit[];
  tags: { name: string; at: number }[];
  /** Tip times of local and remote branches, a sign of how much parallel work the repository sees. */
  branchActivity: number[];
  /** The project's own description for agents (AGENTS.md, else CLAUDE.md) as committed on the base, without code blocks. */
  guide: string | null;
  /** Full messages of the latest base commits, newest first, for links to other tools. */
  messages: string[];
  /** The base branch first, then branches that still have something to integrate, most recent first. */
  branches: ProjectOverviewGitBranch[];
  baseCommitsPerDay: number | null;
};
export type ProjectOverviewGitOptions = {
  now: number;
  defaultBranch?: string | null;
  /** Branches to report even when they have been idle, such as those a live agent works on. */
  keepBranches?: readonly string[];
};

/** Read-only repository facts for the project overview. Local refs only: it never fetches, and output and time are bounded. */
export class ProjectOverviewGitReader {
  private async git(folder: string, args: string[]): Promise<string> {
    const { stdout } = await exec('git', ['--no-pager', ...args], {
      cwd: folder, encoding: 'utf8', timeout: 15_000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' },
    });
    return stdout;
  }

  private async optional(folder: string, args: string[]): Promise<string> {
    return this.git(folder, args).then(output => output.trim(), () => '');
  }

  private async refExists(folder: string, ref: string): Promise<boolean> {
    return this.git(folder, ['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false);
  }

  private async baseBranch(folder: string, branch: string | null, hint?: string | null): Promise<{ name: string; ref: string } | null> {
    const remoteHead = (await this.optional(folder, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//u, '');
    for (const name of [remoteHead, hint?.trim() ?? '', 'main', 'master', branch ?? '']) {
      if (!name) continue;
      for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
        if (await this.refExists(folder, ref)) return { name, ref };
      }
    }
    return null;
  }

  private async guide(folder: string, ref: string): Promise<string | null> {
    for (const file of guideFiles) {
      const text = await this.optional(folder, ['show', `${ref}:${file}`]);
      if (!text) continue;
      const prose = text.replace(/```[\s\S]*?```\n*/gu, '').replace(/\n{3,}/gu, '\n\n').trim();
      return prose.slice(0, maxGuide);
    }
    return null;
  }

  async read(folder: string, options: ProjectOverviewGitOptions): Promise<ProjectOverviewGitFacts | null> {
    const root = await this.optional(folder, ['rev-parse', '--show-toplevel']);
    if (!root) return null;
    const [commonDirectory, branchName] = await Promise.all([
      this.git(folder, ['rev-parse', '--git-common-dir']),
      this.optional(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    ]);
    const name = basename(dirname(resolve(root, commonDirectory.trim())));
    const branch = branchName || null;
    const base = await this.baseBranch(folder, branch, options.defaultBranch);
    if (!base) return { name, branch, baseBranch: null, commits: [], tags: [], branches: [], branchActivity: [], guide: null, messages: [], baseCommitsPerDay: null };

    const [history, tagList, branchList, refList, recent, messageList, guide] = await Promise.all([
      this.git(folder, ['log', '--no-show-signature', `--max-count=${maxCommits}`, '--format=%ct%x00%P%x00%s', '-z', base.ref, '--']),
      this.git(folder, ['for-each-ref', '--merged', base.ref, '--format=%(refname:short)%00%(creatordate:unix)', 'refs/tags']),
      this.git(folder, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(committerdate:unix)', 'refs/heads']),
      this.git(folder, ['for-each-ref', '--sort=-committerdate', `--count=${maxRefs}`, '--format=%(refname)%00%(committerdate:unix)', 'refs/heads', 'refs/remotes']),
      this.git(folder, ['rev-list', '--count', `--since=${new Date(options.now - 7 * day).toISOString()}`, base.ref, '--']),
      this.git(folder, ['log', '--no-show-signature', `--max-count=${maxMessages}`, '--format=%B%x00', base.ref, '--']),
      this.guide(folder, base.ref),
    ]);

    const commits: ProjectOverviewGitCommit[] = [];
    const fields = history.split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
      commits.push({ at: Number(fields[index]) * 1000, merge: fields[index + 1]!.trim().includes(' '), subject: fields[index + 2]! });
    }

    const pairs = (output: string) => output.split('\n').filter(Boolean).map(line => {
      const [name, seconds] = line.split('\0') as [string, string];
      return { name, at: Number(seconds) * 1000 };
    });
    const tags = pairs(tagList).sort((a, b) => a.at - b.at);
    // A remote HEAD only points at another branch.
    const branchActivity = pairs(refList).filter(ref => !ref.name.endsWith('/HEAD')).map(ref => ref.at);

    const keep = new Set([...(options.keepBranches ?? []), ...(branch ? [branch] : [])]);
    const heads = pairs(branchList);
    const baseHead = heads.find(head => head.name === base.name);
    const candidates = heads.filter(head => head.name !== base.name && (keep.has(head.name) || options.now - head.at <= activeBranchAge));
    const inFlight = (await Promise.all(candidates.map(async (head): Promise<ProjectOverviewGitBranch> => {
      const ref = `refs/heads/${head.name}`;
      const [counts, names, size, times] = await Promise.all([
        this.git(folder, ['rev-list', '--left-right', '--count', `${base.ref}...${ref}`, '--']),
        this.git(folder, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', `${base.ref}...${ref}`, '--']),
        this.git(folder, ['diff', '--shortstat', '--no-renames', '--no-ext-diff', `${base.ref}...${ref}`, '--']),
        this.git(folder, ['log', '--no-show-signature', `--max-count=${maxCommits}`, '--format=%ct', `${base.ref}..${ref}`, '--']),
      ]);
      const [behind, ahead] = counts.trim().split(/\s+/u).map(Number) as [number, number];
      const own = times.split('\n').filter(Boolean).map(seconds => Number(seconds) * 1000);
      return {
        name: head.name,
        firstCommitAt: own.length ? Math.min(...own) : head.at,
        lastCommitAt: head.at,
        behind,
        ahead,
        files: names.split('\0').filter(Boolean).sort().slice(0, maxFiles),
        insertions: Number(/(\d+) insertion/u.exec(size)?.[1] ?? 0),
        deletions: Number(/(\d+) deletion/u.exec(size)?.[1] ?? 0),
      };
    }))).filter(candidate => candidate.ahead > 0 || keep.has(candidate.name));

    return {
      name,
      branch,
      baseBranch: base.name,
      commits,
      tags,
      branchActivity,
      guide,
      messages: messageList.split('\0').map(message => message.trim()).filter(Boolean),
      branches: [
        (at => ({ name: base.name, firstCommitAt: at, lastCommitAt: at, behind: 0, ahead: 0, files: [], insertions: 0, deletions: 0 }))(baseHead?.at ?? commits[0]?.at ?? options.now),
        ...inFlight.slice(0, maxBranches - 1),
      ],
      baseCommitsPerDay: Number(recent.trim()) / 7,
    };
  }
}
