import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectOverviewGitReader } from '../git-reader';

const exec = promisify(execFile);
const day = 86_400_000;
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

async function fixture(initialBranch = 'main') {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'korus-overview-')));
  folders.push(folder);
  const git = async (args: string[], at?: string) => (await exec('git', args, {
    cwd: folder,
    env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) },
  })).stdout.trim();
  await git(['init', '-b', initialBranch]);
  await git(['config', 'user.name', 'Overview Author']);
  await git(['config', 'user.email', 'overview@example.test']);
  await git(['config', 'commit.gpgsign', 'false']);
  const commit = async (message: string, files: Record<string, string>, at?: string) => {
    for (const [file, content] of Object.entries(files)) await writeFile(join(folder, file), content);
    await git(['add', '--', ...Object.keys(files)]);
    await git(['commit', '-m', message], at);
  };
  return { folder, git, commit, reader: new ProjectOverviewGitReader() };
}

// Real Git process workflows: each case creates a repository and runs several commands.
describe('project overview git facts', { timeout: 20_000 }, () => {
  it('reads base history, merges, releases, and the drift and changed files of branches still in flight', async () => {
    const { folder, git, commit, reader } = await fixture();
    await commit('feat: one', { 'a.txt': 'one' });
    await commit('fix: two', { 'b.txt': 'two' });
    await git(['tag', 'v1.0.0']);
    await git(['checkout', '-b', 'feat/y']);
    await commit('feat: y work', { 'a.txt': 'changed by y', 'y.txt': 'y' });
    await git(['checkout', 'main']);
    await git(['checkout', '-b', 'feat/x']);
    await commit('feat: x work', { 'x.txt': 'x' });
    await git(['checkout', 'main']);
    await commit('chore: three', { 'c.txt': 'three' });
    await git(['merge', '--no-ff', '-m', "Merge branch 'feat/x'", 'feat/x']);
    await git(['checkout', 'feat/y']);
    const now = Date.now();

    const facts = await reader.read(folder, { now });

    expect(facts).not.toBeNull();
    expect(facts!.name).toBe(basename(folder));
    expect(facts!.branch).toBe('feat/y');
    expect(facts!.baseBranch).toBe('main');
    expect(facts!.commits.map(commit => [commit.subject, commit.merge]).sort()).toStrictEqual([
      ["Merge branch 'feat/x'", true],
      ['chore: three', false],
      ['feat: one', false],
      ['feat: x work', false],
      ['fix: two', false],
    ]);
    expect(facts!.commits.every(commit => Math.abs(commit.at - now) < day)).toBe(true);
    expect(facts!.tags.map(tag => tag.name)).toStrictEqual(['v1.0.0']);
    // The merged branch has nothing left to integrate, so only the base and the open branch remain.
    expect(facts!.branches.map(({ firstCommitAt, lastCommitAt, ...branch }) => ({ ...branch, timed: firstCommitAt <= lastCommitAt && Math.abs(lastCommitAt - now) < day }))).toStrictEqual([
      { name: 'main', behind: 0, ahead: 0, files: [], insertions: 0, deletions: 0, timed: true },
      { name: 'feat/y', behind: 3, ahead: 1, files: ['a.txt', 'y.txt'], insertions: 2, deletions: 1, timed: true },
    ]);
    expect(facts!.baseCommitsPerDay).toBeCloseTo(5 / 7, 5);
    expect(facts!.guide).toBeNull();
    expect(facts!.messages.slice(0, 2)).toStrictEqual(["Merge branch 'feat/x'", 'chore: three']);
    // Every local branch tip counts as branch activity, merged or not.
    expect(facts!.branchActivity).toHaveLength(3);
    expect(facts!.branchActivity.every(at => Math.abs(at - now) < day)).toBe(true);
  });

  it('reads the whole base history so the lookback can be chosen, and keeps an idle branch only when asked', async () => {
    const { folder, git, commit, reader } = await fixture();
    await commit('feat: ancient', { 'a.txt': 'old' }, '2020-01-01T00:00:00Z');
    await git(['tag', 'v0.1.0'], '2020-01-01T00:00:00Z');
    await git(['checkout', '-b', 'feat/stale']);
    await commit('feat: stale work', { 's.txt': 's' }, '2020-01-02T00:00:00Z');
    await git(['checkout', 'main']);
    await commit('fix: recent', { 'b.txt': 'new' });
    const now = Date.now();

    const facts = await reader.read(folder, { now });
    expect(facts!.commits.map(commit => [commit.subject, commit.at])).toStrictEqual([['fix: recent', facts!.commits[0]!.at], ['feat: ancient', Date.parse('2020-01-01T00:00:00Z')]]);
    expect(facts!.tags).toStrictEqual([{ name: 'v0.1.0', at: Date.parse('2020-01-01T00:00:00Z') }]);
    expect(facts!.branchActivity.sort()).toStrictEqual([Date.parse('2020-01-02T00:00:00Z'), facts!.commits[0]!.at]);
    // In flight means active in the last 30 days; an idle branch is left out of the flow.
    expect(facts!.branches.map(branch => branch.name)).toStrictEqual(['main']);
    expect(facts!.baseCommitsPerDay).toBeCloseTo(1 / 7, 5);

    const kept = await reader.read(folder, { now, keepBranches: ['feat/stale'] });
    expect(kept!.branches.map(branch => [branch.name, branch.behind, branch.ahead, branch.files, branch.insertions, branch.deletions])).toStrictEqual([
      ['main', 0, 0, [], 0, 0],
      ['feat/stale', 1, 1, ['s.txt'], 1, 0],
    ]);
    // The branch's own work dates from its first commit ahead of the base, not from the base's history.
    const stale = kept!.branches[1]!;
    expect([stale.firstCommitAt, stale.lastCommitAt]).toStrictEqual([Date.parse('2020-01-02T00:00:00Z'), Date.parse('2020-01-02T00:00:00Z')]);
  });

  it('reads the project guide committed on the base branch, without its code blocks and bounded', async () => {
    const { folder, commit, reader } = await fixture();
    await commit('docs: add the guide', { 'AGENTS.md': `# AGENTS.md\n\nGuide for the repository.\n\n\`\`\`bash\nnpm test\n\`\`\`\n\n## Overview\n\n**Korus** coordinates teams of coding agents.\n${'More detail. '.repeat(400)}` });
    const facts = await reader.read(folder, { now: Date.now() });
    expect(facts!.guide!.startsWith('# AGENTS.md\n\nGuide for the repository.\n\n## Overview\n\n**Korus** coordinates teams of coding agents.')).toBe(true);
    expect(facts!.guide).not.toContain('npm test');
    expect(facts!.guide!.length).toBeLessThanOrEqual(2000);
    expect(facts!.messages).toStrictEqual([`docs: add the guide`]);
  });

  it('uses the workspace default branch as the base and reports a detached head without a branch', async () => {
    const { folder, git, commit, reader } = await fixture('trunk');
    await commit('feat: only', { 'a.txt': 'one' });
    await git(['checkout', '--detach']);
    const now = Date.now();

    const withDefault = await reader.read(folder, { now, defaultBranch: 'trunk' });
    expect(withDefault!.branch).toBeNull();
    expect(withDefault!.baseBranch).toBe('trunk');
    expect(withDefault!.commits.map(commit => commit.subject)).toStrictEqual(['feat: only']);

    // With no remote head, no hint and neither conventional name there is nothing to measure against.
    const unknown = await reader.read(folder, { now });
    expect(unknown).toMatchObject({ baseBranch: null, commits: [], tags: [], branches: [], branchActivity: [], baseCommitsPerDay: null });
  });

  it('answers null for a folder that is not a repository', async () => {
    const folder = await realpath(await mkdtemp(join(tmpdir(), 'korus-overview-plain-')));
    folders.push(folder);
    await expect(new ProjectOverviewGitReader().read(folder, { now: Date.now() })).resolves.toBeNull();
  });
});
