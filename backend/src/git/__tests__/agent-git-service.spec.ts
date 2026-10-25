import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { AgentGitService, parseBranchStatus, parseChangedFiles, parseCommitSummaries, parseNumstat, parsePorcelainFiles } from '../agent-git-service';

describe('agent git service parsers', () => {
  it('parses branch tracking status', () => {
    expect(parseBranchStatus('## main...origin/main [ahead 2, behind 1]\n M README.md\n')).toStrictEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
    });
  });

  it('parses changed and untracked files from porcelain status', () => {
    expect(parseChangedFiles([
      '## main',
      ' M README.md',
      'A  src/main.ts',
      '?? scratch.md',
    ].join('\n'))).toStrictEqual({
      changedFiles: 3,
      hasUntracked: true,
    });
  });

  it('sums numstat lines and ignores binary changes', () => {
    expect(parseNumstat([
      '10\t2\tREADME.md',
      '-\t-\tassets/icon.png',
      '4\t0\tsrc/main.ts',
    ].join('\n'))).toStrictEqual({
      addedLines: 14,
      removedLines: 2,
    });
  });

  it('parses recent commits with their individual diff statistics', () => {
    expect(parseCommitSummaries([
      '\x1eaaaaaaaa\x1faaaaaaa\x1ffirst commit',
      '',
      '3\t1\ta.ts',
      '\x1ebbbbbbbb\x1fbbbbbbb\x1fsecond commit',
      '',
      '2\t0\tb.ts',
    ].join('\n'))).toStrictEqual([
      { sha: 'aaaaaaaa', shortSha: 'aaaaaaa', subject: 'first commit', addedLines: 3, removedLines: 1, changedFiles: 1 },
      { sha: 'bbbbbbbb', shortSha: 'bbbbbbb', subject: 'second commit', addedLines: 2, removedLines: 0, changedFiles: 1 },
    ]);
  });

  it('builds provider-neutral staged, commit, and branch comparisons', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      const command = args.join(' ');
      if (command === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (command === 'symbolic-ref --quiet --short HEAD') return { stdout: 'feature\n' };
      if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return { stdout: 'origin/feature\n' };
      if (command === 'remote') return { stdout: 'origin\n' };
      if (command === 'remote get-url origin') return { stdout: 'git@github.com:owner/repo.git\n' };
      if (command === 'status --porcelain=v1 -z') return { stdout: '' };
      if (command === 'status --porcelain=v1 --branch') return { stdout: '## feature...origin/feature\n' };
      if (command === 'worktree list --porcelain') return { stdout: 'worktree /repo\nbranch refs/heads/feature\n' };
      if (command === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return { stdout: 'origin/main\n' };
      if (command === 'rev-parse --verify --quiet origin/main^{commit}') return { stdout: 'base-sha\n' };
      if (command === 'merge-base HEAD origin/main') return { stdout: 'base-sha\n' };
      if (command === 'diff --no-ext-diff base-sha --') return { stdout: 'branch diff\n' };
      if (command === 'diff --numstat base-sha --') return { stdout: '4\t2\ta.ts\n' };
      if (command === 'diff --cached --no-ext-diff --') return { stdout: 'staged diff\n' };
      if (command === 'diff --no-ext-diff --') return { stdout: 'unstaged diff\n' };
      if (command === 'diff --cached --numstat --' || command === 'diff --numstat --') return { stdout: '' };
      if (command === 'ls-files --others --exclude-standard -z --') return { stdout: '' };
      if (command === 'rev-parse --verify --quiet abcdef12^{commit}') return { stdout: 'abcdef12\n' };
      if (command === 'show --format= --no-ext-diff abcdef12 --') return { stdout: 'commit diff\n' };
      if (command === 'show --format= --numstat abcdef12 --') return { stdout: '7\t3\tb.ts\n' };
      throw new Error(`Unexpected git command: ${command}`);
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.diff('/repo', { type: 'staged' })).resolves.toMatchObject({
      target: { type: 'staged' },
      diff: 'staged diff\n',
    });
    await expect(service.diff('/repo', { type: 'commit', sha: 'abcdef12' })).resolves.toMatchObject({
      target: { type: 'commit', sha: 'abcdef12' },
      summary: { addedLines: 7, removedLines: 3, changedFiles: 1 },
      diff: 'commit diff\n',
    });
    await expect(service.diff('/repo', { type: 'branch' })).resolves.toMatchObject({
      target: { type: 'branch', baseRef: 'origin/main' },
      summary: { addedLines: 4, removedLines: 2, changedFiles: 1 },
      diff: 'branch diff\n',
    });
  });

  it('reviews staged and unstaged tracked changes against HEAD', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'status') {
        return { stdout: '## main...origin/main\n M src/a.ts\nM  src/b.ts\n' };
      }
      if (args.includes('--cached')) return { stdout: '3\t1\tsrc/b.ts\n' };
      if (args.includes('--numstat')) return { stdout: '5\t2\tsrc/a.ts\n' };
      if (args[0] === 'ls-files') {
        return { stdout: '' };
      }
      return { stdout: 'diff --git a/src/a.ts b/src/a.ts\n' };
    });
    const service = new AgentGitService(() => new Date('2026-08-01T00:00:00.000Z'), runGit);

    await expect(service.status('/repo')).resolves.toMatchObject({
      addedLines: 5,
      removedLines: 2,
      changedFiles: 2,
      state: 'dirty',
      diffCatalog: {
        uncommitted: { addedLines: 5, removedLines: 2, changedFiles: 2 },
        unstaged: { addedLines: 5, removedLines: 2, changedFiles: 1 },
        staged: { addedLines: 3, removedLines: 1, changedFiles: 1 },
      },
    });
    await expect(service.diff('/repo')).resolves.toMatchObject({
      diff: 'diff --git a/src/a.ts b/src/a.ts\n',
      sections: [
        { scope: 'staged', diff: '3\t1\tsrc/b.ts\n' },
        { scope: 'unstaged', diff: 'diff --git a/src/a.ts b/src/a.ts\n' },
        { scope: 'untracked', diff: '' },
      ],
    });

    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--cached', '--numstat', '--']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--numstat', '--']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--no-ext-diff', '--']);
  });

  it('includes untracked files in the shared working-tree totals', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '## main...origin/main\n M src/a.ts\n?? src/new.ts\n' };
      if (args[0] === 'ls-files') return { stdout: 'src/new.ts\0' };
      if (args.includes('--no-index')) return { stdout: '5\t0\tsrc/new.ts\n' };
      if (args.includes('--cached')) return { stdout: '' };
      if (args[0] === 'diff' && args.includes('--numstat')) return { stdout: '2\t1\tsrc/a.ts\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date('2026-08-01T00:00:00.000Z'), runGit);

    await expect(service.status('/repo')).resolves.toMatchObject({
      addedLines: 7,
      removedLines: 1,
      changedFiles: 2,
      hasUntracked: true,
      state: 'dirty',
    });
  });

  it('reports the primary repository name for a linked worktree', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '## test\n' };
      if (args[0] === 'rev-parse') return { stdout: '/Users/nbonamy/src/agent-workspace-git-fixture/.git\n' };
      if (args[0] === 'remote') return { stdout: 'origin\tgit@github.com:nbonamy/agent-workspace-git-fixture.git (fetch)\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.status('/Users/nbonamy/src/agent-workspace-git-fixture-test')).resolves.toMatchObject({
      repository: 'agent-workspace-git-fixture',
      githubRepository: 'nbonamy/agent-workspace-git-fixture',
      branch: 'test',
    });
  });

  it('detects the remote default independently of the checked-out branch and linked worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'korus-branch-identity-'));
    const repo = join(root, 'repo');
    const worktree = join(root, 'linked');
    const exec = promisify(execFile);
    const run = (args: string[]) => exec('git', args, { cwd: repo });
    try {
      await exec('git', ['init', '--initial-branch=trunk', repo]);
      await run(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture']);
      await run(['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
      await run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
      const service = new AgentGitService();
      await expect(service.identity(repo)).resolves.toMatchObject({ branch: 'trunk', defaultBranch: 'trunk', isLinkedWorktree: false });
      await run(['checkout', '-b', 'main']);
      await expect(service.identity(repo)).resolves.toMatchObject({ branch: 'main', defaultBranch: 'trunk', isLinkedWorktree: false });
      await run(['worktree', 'add', worktree, 'trunk']);
      await expect(service.identity(worktree)).resolves.toMatchObject({ branch: 'trunk', defaultBranch: 'trunk', isLinkedWorktree: true });
      await run(['checkout', '--detach']);
      await expect(service.identity(repo)).resolves.toMatchObject({ branch: null, defaultBranch: 'trunk' });
      await run(['symbolic-ref', '--delete', 'refs/remotes/origin/HEAD']);
      await expect(service.identity(repo)).resolves.toMatchObject({ defaultBranch: 'main' });
      await expect(service.identity(root)).resolves.toMatchObject({ kind: 'folder' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves lightweight workspace identity for a primary checkout', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/src/agent-workspace\n' };
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { stdout: '.git\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'main\n' };
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    });
    const service = new AgentGitService(() => new Date('2026-08-27T12:00:00.000Z'), runGit);

    await expect(service.identity('/src/agent-workspace')).resolves.toStrictEqual({
      kind: 'git',
      folder: '/src/agent-workspace',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/src/agent-workspace',
      branch: 'main',
      defaultBranch: null,
      isLinkedWorktree: false,
      primaryWorktreeRoot: '/src/agent-workspace',
      updatedAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it('resolves linked worktree and detached workspace identity', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/src/agent-workspace-feature\n' };
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { stdout: '/src/agent-workspace/.git\n' };
      if (args[0] === 'symbolic-ref') throw new Error('detached HEAD');
      if (args[0] === 'remote' && args[1] === 'get-url') return { stdout: 'git@github.com:nbonamy/agent-workspace.git\n' };
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    });
    const service = new AgentGitService(() => new Date('2026-08-27T12:00:00.000Z'), runGit);

    await expect(service.identity('/src/agent-workspace-feature')).resolves.toStrictEqual({
      kind: 'git',
      folder: '/src/agent-workspace-feature',
      repositoryName: 'agent-workspace',
      repositoryRoot: '/src/agent-workspace-feature',
      branch: null,
      defaultBranch: null,
      isLinkedWorktree: true,
      primaryWorktreeRoot: '/src/agent-workspace',
      originUrl: 'github.com:nbonamy/agent-workspace.git',
      updatedAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it('removes credentials from the persisted workspace origin', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/src/agent-workspace\n' };
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { stdout: '.git\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'main\n' };
      if (args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://oauth2:secret@github.com/openai/agent-workspace.git?token=secret\n' };
      }
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    });
    const service = new AgentGitService(() => new Date('2026-08-27T12:00:00.000Z'), runGit);

    await expect(service.identity('/src/agent-workspace')).resolves.toMatchObject({
      originUrl: 'https://github.com/openai/agent-workspace.git',
    });
  });

  it('falls back to folder identity outside Git', async () => {
    const runGit = vi.fn(async () => {
      throw new Error('not a git repository');
    });
    const service = new AgentGitService(() => new Date('2026-08-27T12:00:00.000Z'), runGit);

    await expect(service.identity('/src/notes')).resolves.toStrictEqual({
      kind: 'folder',
      folder: '/src/notes',
      label: 'notes',
      updatedAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it('reviews staged plus unstaged diffs before the first commit', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'diff' && args[1] === 'HEAD') throw new Error('bad revision HEAD');
      if (args.includes('--cached')) {
        return { stdout: 'staged diff' };
      }
      if (args[0] === 'ls-files') {
        return { stdout: '' };
      }
      return { stdout: 'unstaged diff' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.diff('/new-repo')).resolves.toMatchObject({
      diff: 'staged diff\nunstaged diff',
      sections: [
        { scope: 'staged', diff: 'staged diff' },
        { scope: 'unstaged', diff: 'unstaged diff' },
        { scope: 'untracked', diff: '' },
      ],
    });
    expect(runGit).toHaveBeenCalledWith('/new-repo', ['diff', '--cached', '--no-ext-diff', '--']);
    expect(runGit).toHaveBeenCalledWith('/new-repo', ['diff', '--no-ext-diff', '--']);
  });

  it('appends diffs for untracked files', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'ls-files') {
        return { stdout: 'new file.ts\0-leading-dash.md\0' };
      }
      if (args.includes('--no-index')) {
        const file = args.at(-1);
        return { stdout: `diff --git a/${file} b/${file}\n` };
      }
      if (args.includes('--cached')) return { stdout: '' };
      return { stdout: 'tracked diff\n' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.diff('/repo')).resolves.toMatchObject({
      diff: [
        'tracked diff\n',
        'diff --git a/new file.ts b/new file.ts\n',
        'diff --git a/-leading-dash.md b/-leading-dash.md\n',
      ].join(''),
      sections: [
        { scope: 'staged', diff: '' },
        { scope: 'unstaged', diff: 'tracked diff\n' },
        {
          scope: 'untracked',
          diff: 'diff --git a/new file.ts b/new file.ts\ndiff --git a/-leading-dash.md b/-leading-dash.md\n',
        },
      ],
    });
    expect(runGit).toHaveBeenCalledWith('/repo', [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
    ]);
    expect(runGit).toHaveBeenCalledWith('/repo', [
      'diff',
      '--no-index',
      '--no-ext-diff',
      '--',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-leading-dash.md',
    ]);
  });

  it('returns staged, unstaged, and untracked review sections independently', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'ls-files') return { stdout: 'src/new.ts\0' };
      if (args.includes('--no-index')) return { stdout: 'untracked diff\n' };
      if (args.includes('--cached')) return { stdout: 'staged diff\n' };
      return { stdout: 'unstaged diff\n' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.diffSections('/repo')).resolves.toStrictEqual([
      { scope: 'staged', diff: 'staged diff\n' },
      { scope: 'unstaged', diff: 'unstaged diff\n' },
      { scope: 'untracked', diff: 'untracked diff\n' },
    ]);
    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--cached', '--no-ext-diff', '--']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--no-ext-diff', '--']);
  });

  it('builds commit generation context from exactly the selected scopes', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'ls-files') return { stdout: 'new.ts\0' };
      if (args.includes('--no-index')) return { stdout: 'untracked diff\n' };
      if (args.includes('--cached')) return { stdout: 'staged diff\n' };
      return { stdout: 'unstaged diff\n' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.commitMessageContext('/repo', {
      includeUnstaged: false,
      includeUntracked: true,
    })).resolves.toStrictEqual({
      context: '## staged changes\nstaged diff\n\n## untracked changes\nuntracked diff',
    });
  });

  it('builds pull request generation context from the branch merge base', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref' && args[3] === 'HEAD') return { stdout: 'feature/demo\n' };
      if (args.includes('@{upstream}')) return { stdout: 'origin/feature/demo\n' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: 'origin\n' };
      if (args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' };
      if (args[0] === 'status') return { stdout: '## feature/demo...origin/feature/demo\n' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/feature/demo\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'origin/main\n' };
      if (args[0] === 'log') return { stdout: 'abc123 feat: add flow\n\n' };
      if (args[0] === 'diff' && args.includes('--stat')) return { stdout: 'src/a.ts | 2 ++\n' };
      if (args[0] === 'diff' && args.includes('origin/main...HEAD')) return { stdout: 'branch diff\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.pullRequestMessageContext('/repo')).resolves.toStrictEqual({
      baseRef: 'origin/main',
      context: [
        '## Base\norigin/main',
        '## Commits\nabc123 feat: add flow',
        '## Diff stat\nsrc/a.ts | 2 ++',
        '## Diff\nbranch diff',
      ].join('\n\n'),
    });
    expect(runGit).toHaveBeenCalledWith('/repo', ['diff', '--no-ext-diff', 'origin/main...HEAD', '--']);
  });

  it.each(['github', 'gitlab'])('explains that %s uncommitted work must be committed first', async provider => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref' && args[3] === 'HEAD') return { stdout: 'fix/issue-7\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: 'origin\n' };
      if (args[0] === 'remote') return { stdout: `git@${provider}.com:owner/repo.git\n` };
      if (args[0] === 'status') return { stdout: ' M src/app.js\0' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/fix/issue-7\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'origin/main\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.pullRequestMessageContext('/repo')).rejects.toThrow(
      `This branch has no committed changes to include. Commit your work before creating a ${provider === 'gitlab' ? 'merge request' : 'pull request'}.`,
    );
  });

  it('rejects pull request generation from an integration branch', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'main\n' };
      if (args.includes('@{upstream}')) return { stdout: 'origin/main\n' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: 'origin\n' };
      if (args[0] === 'remote') return { stdout: 'git@github.com:owner/repo.git\n' };
      if (args[0] === 'status') return { stdout: ' M src/a.ts\0' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.pullRequestMessageContext('/repo')).rejects.toThrow('Create a feature branch');
    expect(runGit.mock.calls.some(([, args]) => args[0] === 'log')).toBe(false);
  });

  it('inspects workflow state and performs bounded git mutations', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: 'origin\n' };
      if (args[0] === 'remote') return { stdout: 'git@github.com:nbonamy/agent-workspace.git\n' };
      if (args[0] === 'status') return { stdout: ' M src/a.ts\0?? src/new.ts\0' };
      if (args.includes('--no-index')) return { stdout: '2\t0\tsrc/new.ts\n' };
      if (args[0] === 'diff' && args[1] === '--cached') return { stdout: '4\t1\tsrc/a.ts\n' };
      if (args[0] === 'diff') return { stdout: '2\t0\tsrc/a.ts\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.workflow('/repo')).resolves.toMatchObject({
      repository: 'nbonamy/agent-workspace', branch: 'feature', remote: 'origin', detached: false,
      isLinkedWorktree: false,
      unstagedFiles: ['src/a.ts', 'src/new.ts'], stagedFiles: [],
      stagedAddedLines: 4, stagedRemovedLines: 1,
      unstagedAddedLines: 2, unstagedRemovedLines: 0,
      untrackedAddedLines: 2, untrackedRemovedLines: 0,
    });
    await service.stage('/repo', ['src/a.ts']);
    await service.commit('/repo', 'feat: ship workflow');
    await service.push('/repo', 'origin', 'feature', true);
    expect(runGit).toHaveBeenCalledWith('/repo', ['add', '--', 'src/a.ts']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['commit', '-m', 'feat: ship workflow']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['push', '--set-upstream', 'origin', 'feature']);
  });

  it('validates, creates, and checks out a branch from the current HEAD', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'show-ref') throw new Error('missing ref');
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.createBranch('/repo', ' feature/from-current ')).resolves.toBe('/repo');

    expect(runGit.mock.calls).toStrictEqual([
      ['/repo', ['check-ref-format', '--branch', 'feature/from-current']],
      ['/repo', ['show-ref', '--verify', '--quiet', 'refs/heads/feature/from-current']],
      ['/repo', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']],
      ['/repo', ['switch', '-c', 'feature/from-current']],
    ]);
  });

  it('delegates linked worktree creation through the shared worktree seam', async () => {
    const runGit = vi.fn().mockResolvedValue({ stdout: '' });
    const createWorktree = vi.fn().mockResolvedValue({ path: '/repo-feature-worktree' });
    const service = new AgentGitService(() => new Date(), runGit, createWorktree);

    await expect(service.createBranch('/repo', 'feature/worktree', true)).resolves.toBe('/repo-feature-worktree');

    expect(createWorktree).toHaveBeenCalledWith({
      repoPath: '/repo',
      branchName: 'feature/worktree',
      reuseExisting: true,
    });
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(runGit).toHaveBeenCalledWith('/repo', ['check-ref-format', '--branch', 'feature/worktree']);
  });

  it('rejects empty, option-like, and invalid branch names before switching', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'check-ref-format') throw new Error('invalid ref');
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.createBranch('/repo', ' ')).rejects.toThrow('Enter a branch name.');
    await expect(service.createBranch('/repo', '-dangerous')).rejects.toThrow('Enter a valid branch name.');
    await expect(service.createBranch('/repo', 'bad name')).rejects.toThrow('Enter a valid branch name.');
    expect(runGit).not.toHaveBeenCalledWith('/repo', expect.arrayContaining(['switch']));
  });

  it('deletes a clean linked worktree, its local branch, and the opted-in remote branch', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return {
          stdout: [
            'worktree /repo',
            'HEAD abc',
            'branch refs/heads/main',
            '',
            'worktree /repo-fix-gh-22',
            'HEAD def',
            'branch refs/heads/fix/gh-22',
            '',
          ].join('\n'),
        };
      }
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo-fix-gh-22',
      isLinkedWorktree: true,
      branch: 'fix/gh-22',
      detached: false,
      remote: 'origin',
      upstream: 'origin/fix/gh-22',
      ahead: 0,
      behind: 0,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
    });

    await service.deleteLinkedWorktree('/repo-fix-gh-22', true);

    expect(runGit.mock.calls).toStrictEqual([
      ['/repo-fix-gh-22', ['worktree', 'list', '--porcelain']],
      ['/repo', ['push', 'origin', '--delete', 'fix/gh-22']],
      ['/repo', ['worktree', 'remove', '/repo-fix-gh-22']],
      ['/repo', ['branch', '-D', 'fix/gh-22']],
    ]);
  });

  it('refuses to delete a linked worktree with uncommitted changes', async () => {
    const runGit = vi.fn();
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo-fix-gh-22',
      isLinkedWorktree: true,
      branch: 'fix/gh-22',
      detached: false,
      ahead: 0,
      behind: 0,
      files: [{ path: 'src/index.ts', indexStatus: ' ', worktreeStatus: 'M' }],
      stagedFiles: [],
      unstagedFiles: ['src/index.ts'],
    });

    await expect(service.validateLinkedWorktreeDeletion('/repo-fix-gh-22')).rejects.toThrow(
      'Commit or discard the worktree changes before deleting it.',
    );
    expect(runGit).not.toHaveBeenCalled();
  });

  it('force-removes a linked worktree when the caller explicitly discards its changes', async () => {
    const runGit = vi.fn().mockResolvedValue({ stdout: 'worktree /repo\n\nworktree /repo-fix-gh-22\n' });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo-fix-gh-22',
      isLinkedWorktree: true,
      branch: 'fix/gh-22',
      detached: false,
      ahead: 0,
      behind: 0,
      files: [{ path: 'src/index.ts', indexStatus: ' ', worktreeStatus: 'M' }],
      stagedFiles: [],
      unstagedFiles: ['src/index.ts'],
    });

    await service.validateLinkedWorktreeDeletion('/repo-fix-gh-22', false, undefined, true);
    await service.deleteLinkedWorktree('/repo-fix-gh-22', false, undefined, true);

    expect(runGit).toHaveBeenCalledWith('/repo', ['worktree', 'remove', '--force', '/repo-fix-gh-22']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['branch', '-D', 'fix/gh-22']);
  });

  it('refuses merged pull-request cleanup after new local commits were added', async () => {
    const runGit = vi.fn().mockResolvedValue({ stdout: 'newer-local-head\n' });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo',
      folder: '/repo-feature',
      isLinkedWorktree: true,
      branch: 'feature',
      detached: false,
      remote: 'origin',
      upstream: 'origin/feature',
      ahead: 0,
      behind: 0,
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
    });

    await expect(service.validateLinkedWorktreeDeletion('/repo-feature', false, 'merged-head')).rejects.toThrow(
      'This branch contains commits that are not part of the tracked request.',
    );
    expect(runGit).toHaveBeenCalledWith('/repo-feature', ['rev-parse', 'HEAD']);
    expect(runGit.mock.calls.some(([, args]) => args[0] === 'worktree')).toBe(false);
  });

  it('reports whether the repository folder is a secondary linked worktree', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.workflow('/repo-feature')).resolves.toMatchObject({
      folder: '/repo-feature',
      isLinkedWorktree: true,
      baseBranch: 'main',
      baseUpdateRequired: false,
    });
  });

  it('reports when a linked worktree branch does not contain the latest base branch', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      if (args[0] === 'merge-base') throw new Error('base branch is not an ancestor');
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.workflow('/repo-feature')).resolves.toMatchObject({
      baseBranch: 'main',
      branch: 'feature',
      baseUpdateRequired: true,
    });
    expect(runGit).toHaveBeenCalledWith('/repo-feature', ['merge-base', '--is-ancestor', 'main', 'feature']);
  });

  it('reports uncommitted changes in the base worktree independently from the feature worktree', async () => {
    const runGit = vi.fn(async (folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && folder === '/repo') return { stdout: ' M src/main-only.ts\0' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.workflow('/repo-feature')).resolves.toMatchObject({
      files: [],
      baseBranch: 'main',
      baseWorktreeDirty: true,
    });
  });

  it('merges the checked-out base branch into a clean linked worktree', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'worktree') {
        return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature/demo\n' };
      }
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo', folder: '/repo-feature', isLinkedWorktree: true,
      baseBranch: 'main', branch: 'feature/demo', detached: false, ahead: 0, behind: 0,
      files: [], stagedFiles: [], unstagedFiles: [],
    });

    await expect(service.updateFromBase('/repo-feature')).resolves.toStrictEqual({
      baseBranch: 'main',
      branch: 'feature/demo',
      conflicts: [],
    });
    expect(runGit).toHaveBeenCalledWith('/repo-feature', ['merge', '--ff', '--no-edit', '--no-autostash', 'main']);
  });

  it('blocks a dirty update unless explicitly allowed and preserves conflicts for the agent', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'worktree') {
        return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature/demo\n' };
      }
      if (args[0] === 'merge') throw new Error('CONFLICT (content): Merge conflict in src/app.ts');
      if (args[0] === 'diff') return { stdout: 'src/app.ts\0src/state.ts\0' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo', folder: '/repo-feature', isLinkedWorktree: true,
      baseBranch: 'main', branch: 'feature/demo', detached: false, ahead: 0, behind: 0,
      files: [{ path: 'notes.md', indexStatus: ' ', worktreeStatus: 'M' }], stagedFiles: [], unstagedFiles: ['notes.md'],
    });

    await expect(service.updateFromBase('/repo-feature')).rejects.toThrow('Commit your changes before updating');
    expect(runGit).not.toHaveBeenCalled();

    await expect(service.updateFromBase('/repo-feature', true)).resolves.toStrictEqual({
      baseBranch: 'main',
      branch: 'feature/demo',
      conflicts: ['src/app.ts', 'src/state.ts'],
    });
    expect(runGit).toHaveBeenCalledWith('/repo-feature', ['diff', '--name-only', '--diff-filter=U', '-z']);
  });

  it('rejects staging paths that escape the repository', async () => {
    const service = new AgentGitService(() => new Date(), vi.fn());
    await expect(service.stage('/repo', ['../secret'])).rejects.toThrow('inside the repository');
    expect(parsePorcelainFiles('R  new.ts\0old.ts\0')).toStrictEqual([{ path: 'old.ts', indexStatus: 'R', worktreeStatus: ' ' }]);
  });

  it('merges a feature worktree into the main worktree and applies cleanup options', async () => {
    const runGit = vi.fn(async (folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      if (args[0] === 'branch' && args[1] === '-d') throw new Error("the branch 'feature' is not fully merged");
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);
    await expect(service.merge('/repo-feature', 'squash', true, true, 'feat: combine the workflow')).resolves.toStrictEqual({
      targetFolder: '/repo',
    });
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge-base', '--is-ancestor', 'main', 'feature']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge', '--squash', 'feature']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['commit', '-m', 'feat: combine the workflow']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['branch', '-D', 'feature']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['worktree', 'remove', '/repo-feature']);
    const removeWorktreeCall = runGit.mock.calls.findIndex(([, args]) => args[0] === 'worktree' && args[1] === 'remove');
    const deleteBranchCall = runGit.mock.calls.findIndex(([, args]) => args[0] === 'branch' && args[1] === '-D');
    expect(removeWorktreeCall).toBeLessThan(deleteBranchCall);
  });

  it('continues merge cleanup when Git removed the worktree registration but left its folder', async () => {
    let worktreeListCalls = 0;
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree' && args[1] === 'list') {
        worktreeListCalls += 1;
        return {
          stdout: worktreeListCalls === 1
            ? 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n'
            : 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n',
        };
      }
      if (args[0] === 'worktree' && args[1] === 'remove') {
        throw new Error("failed to delete '/repo-feature': Directory not empty");
      }
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo-feature', 'merge', true, true)).resolves.toStrictEqual({
      targetFolder: '/repo',
      warning: { type: 'worktreeFolderRetained', folder: '/repo-feature' },
    });

    expect(runGit).toHaveBeenCalledWith('/repo', ['branch', '-D', 'feature']);
  });

  it('requires a commit message before starting a squash merge', async () => {
    const runGit = vi.fn();
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo-feature', 'squash', false, false, '  ')).rejects.toThrow('Enter a squash commit message.');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('refuses to merge before main is an ancestor of the feature branch', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') {
        return { stdout: 'worktree /repo\nHEAD main-head\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD feature-head\nbranch refs/heads/feature\n' };
      }
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
        throw new Error('not an ancestor');
      }
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo-feature', 'merge', true, true)).rejects.toThrow(
      'feature is not up to date with main. Update the branch with main before merging.',
    );
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge-base', '--is-ancestor', 'main', 'feature']);
    expect(runGit.mock.calls.some(([, args]) => (
      args[0] === 'merge' || args[0] === 'worktree' && args[1] === 'remove' || args[0] === 'branch' && ['-d', '-D'].includes(args[1]!)
    ))).toBe(false);
  });

  it('refuses to merge while the target worktree has uncommitted changes', async () => {
    const runGit = vi.fn(async (folder: string, args: string[]) => {
      if (args[0] === 'worktree') {
        return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      }
      if (args[0] === 'status' && folder === '/repo') return { stdout: ' M src/main-only.ts\0' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);
    vi.spyOn(service, 'workflow').mockResolvedValue({
      repository: 'owner/repo', folder: '/repo-feature', isLinkedWorktree: true,
      baseBranch: 'main', branch: 'feature', detached: false, ahead: 0, behind: 0,
      files: [], stagedFiles: [], unstagedFiles: [],
    });

    await expect(service.merge('/repo-feature', 'merge', false, false)).rejects.toThrow(
      'Commit changes in main before merging.',
    );
    expect(runGit).toHaveBeenCalledWith('/repo', ['status', '--porcelain=v1', '-z']);
    expect(runGit.mock.calls.some(([, args]) => args[0] === 'merge')).toBe(false);
  });

  it('rejects worktree cleanup from a primary checkout', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status') return { stdout: '## feature\n' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo', 'merge', false, true)).rejects.toThrow('not a linked worktree');
    expect(runGit.mock.calls.some(([folder, args]) => folder !== '/repo' || args[0] === 'merge')).toBe(false);
  });

  it('does not delete a branch that remains checked out in its linked worktree', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo-feature', 'merge', true, false)).rejects.toThrow('Remove the linked worktree');
    expect(runGit.mock.calls.some(([, args]) => args[0] === 'merge' || args[0] === 'branch')).toBe(false);
  });

  it('uses safe branch deletion after a merge commit without pushing the base branch', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote' && args[1] === undefined) return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await service.merge('/repo-feature', 'merge', true, true);

    expect(runGit).toHaveBeenCalledWith('/repo', ['merge', '--no-ff', 'feature']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge-base', '--is-ancestor', 'feature', 'HEAD']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['branch', '-D', 'feature']);
    expect(runGit.mock.calls.some(([, args]) => args[0] === 'push')).toBe(false);
  });

  it('resolves the base worktree as the merged-branch push target', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo-feature\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status') return { stdout: '## feature\n' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def\nbranch refs/heads/feature\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.mergeTarget('/repo-feature')).resolves.toBe('/repo');
  });

  it('switches a primary feature checkout to its base branch before merging', async () => {
    const runGit = vi.fn(async (_folder: string, args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: '/repo\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'feature/demo\n' };
      if (args.includes('@{upstream}')) return { stdout: '' };
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'status' && args.includes('--branch')) return { stdout: '## feature/demo\n' };
      if (args[0] === 'status') return { stdout: '' };
      if (args[0] === 'worktree') return { stdout: 'worktree /repo\nHEAD def\nbranch refs/heads/feature/demo\n' };
      if (args[0] === 'branch' && args.includes('--format=%(refname:short)')) return { stdout: 'feature/demo\nmain\n' };
      return { stdout: '' };
    });
    const service = new AgentGitService(() => new Date(), runGit);

    await expect(service.merge('/repo', 'merge', false, false)).resolves.toStrictEqual({ targetFolder: '/repo' });
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge-base', '--is-ancestor', 'main', 'feature/demo']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['switch', 'main']);
    expect(runGit).toHaveBeenCalledWith('/repo', ['merge', '--no-ff', 'feature/demo']);
    const freshnessCall = runGit.mock.calls.findIndex(([, args]) => args[0] === 'merge-base');
    const switchCall = runGit.mock.calls.findIndex(([, args]) => args[0] === 'switch');
    expect(freshnessCall).toBeLessThan(switchCall);
  });
});
