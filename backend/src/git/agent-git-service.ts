import { product } from '@workspace/core/product';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { normalizeGitSettings, type GitSettings } from '@workspace/core/git-preferences';
import type { AgentPullRequestTracking, AgentGitCommitSummary, AgentGitDiff, AgentGitDiffCatalog, AgentGitDiffSection, AgentGitDiffSummary, AgentGitDiffTarget, AgentGitFile, AgentGitWorkflow, AgentWorkspaceIdentity } from '@workspace/core/contracts';
import { AppError } from '@workspace/core/app-error';
import { canonicalGitRemoteIdentity, matchingBranchUpstream, sanitizeGitRemoteUrl } from '@workspace/core/git-remote';
import type { AgentGitStatus } from '@workspace/core/contracts';
import { listSourceBranches, type GitWorktreeCreateInput } from '../git-worktrees';
import { AgentGitHistoryService } from './agent-git-history-service';
import { GitPruneService } from './git-prune-service';

const execFileAsync = promisify(execFile);

export type AgentGitServiceClock = () => Date;
export type AgentGitRunner = (cwd: string, args: string[]) => Promise<{ stdout: string }>;
type AgentGitWorktreeCreator = (input: GitWorktreeCreateInput) => Promise<{ path: string }>;

export type AgentGitMergeResult = {
  targetFolder: string;
  warning?: NonNullable<AgentGitWorkflow['warning']>;
};

export type AgentGitGenerationContext = {
  context: string;
  baseRef?: string;
};

export class AgentGitService {
  readonly history = new AgentGitHistoryService();
  readonly pruning: GitPruneService;
  private settings: () => GitSettings = () => normalizeGitSettings(undefined);

  setSettingsProvider(provider: () => GitSettings): void { this.settings = provider; }

  constructor(
    private readonly now: AgentGitServiceClock = () => new Date(),
    private readonly runGit: AgentGitRunner = git,
    private readonly createWorktree?: AgentGitWorktreeCreator,
  ) { this.pruning = new GitPruneService(runGit); }

  async identity(folder: string): Promise<AgentWorkspaceIdentity> {
    const updatedAt = this.now().toISOString();
    try {
      const [rootResult, branchResult, commonDirectoryResult, originResult, branches] = await Promise.all([
        this.runGit(folder, ['rev-parse', '--show-toplevel']),
        this.runGit(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ({ stdout: '' })),
        this.runGit(folder, ['rev-parse', '--git-common-dir']),
        this.runGit(folder, ['remote', 'get-url', 'origin']).catch(() => ({ stdout: '' })),
        listSourceBranches(folder, {
          run: (_command, args, { cwd }) => this.runGit(cwd, args),
        }).catch(() => []),
      ]);
      const repositoryRoot = resolve(rootResult.stdout.trim());
      const commonDirectory = resolve(repositoryRoot, commonDirectoryResult.stdout.trim());
      const primaryWorktreeRoot = dirname(commonDirectory);
      const branch = branchResult.stdout.trim() || null;
      const originUrl = sanitizeGitRemoteUrl(originResult.stdout);

      return {
        kind: 'git',
        folder,
        repositoryName: fileName(primaryWorktreeRoot),
        repositoryRoot,
        branch,
        defaultBranch: branches.find((candidate) => candidate.isDefault)?.name ?? null,
        isLinkedWorktree: repositoryRoot !== primaryWorktreeRoot,
        primaryWorktreeRoot,
        ...(originUrl ? { originUrl } : {}),
        updatedAt,
      };
    } catch {
      return {
        kind: 'folder',
        folder,
        label: fileName(resolve(folder)),
        updatedAt,
      };
    }
  }

  async status(folder: string): Promise<AgentGitStatus> {
    const updatedAt = this.now().toISOString();
    try {
      const [statusResult, stagedNumstat, unstagedNumstat, untrackedFilesResult, commonDirectoryResult, remotesResult] = await Promise.all([
        this.runGit(folder, ['status', '--porcelain=v1', '--branch']),
        this.runGit(folder, ['diff', '--cached', '--numstat', '--']),
        this.runGit(folder, ['diff', '--numstat', '--']),
        this.runGit(folder, ['ls-files', '--others', '--exclude-standard', '-z', '--']),
        this.runGit(folder, ['rev-parse', '--git-common-dir']).catch(() => ({ stdout: '' })),
        this.runGit(folder, ['remote', '-v']).catch(() => ({ stdout: '' })),
      ]);
      const branch = parseBranchStatus(statusResult.stdout);
      const stagedDiff = parseNumstat(stagedNumstat.stdout);
      const unstagedDiff = parseNumstat(unstagedNumstat.stdout);
      const untrackedDiff = await untrackedNumstat(this.runGit, folder, untrackedFilesResult.stdout.split('\0').filter(Boolean));
      const trackedUncommitted = await this.runGit(folder, ['diff', 'HEAD', '--numstat', '--'])
        .then((result) => parseNumstatSummary(result.stdout))
        .catch(() => combineSummaries(stagedDiff, unstagedDiff));
      const diff = combineSummaries(trackedUncommitted, untrackedDiff);
      const changed = parseChangedFiles(statusResult.stdout);
      const isDirty = changed.changedFiles > 0 || diff.addedLines > 0 || diff.removedLines > 0;
      const commonDirectory = commonDirectoryResult.stdout.trim();
      const repository = commonDirectory ? fileName(dirname(resolve(folder, commonDirectory))) : undefined;
      const entries = remotesResult.stdout.split(/\r?\n/).map(line => line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/)).filter(Boolean);
      const selected = entries.find(entry => entry![1] === branch.upstream?.split('/')[0])
        ?? entries.find(entry => entry![1] === 'origin') ?? entries[0];
      const remoteIdentity = selected ? canonicalGitRemoteIdentity(selected[2]!) : undefined;
      const repositoryProvider = remoteIdentity?.startsWith('gitlab.com/') ? 'gitlab' : remoteIdentity?.startsWith('github.com/') ? 'github' : undefined;
      const githubRepository = repositoryProvider === 'github' ? remoteIdentity!.slice(11) : undefined;
      const diffCatalog = await this.diffCatalog(folder, {
        branch: branch.branch,
        remote: selected?.[1],
        staged: parseNumstatSummary(stagedNumstat.stdout),
        unstaged: combineSummaries(parseNumstatSummary(unstagedNumstat.stdout), untrackedDiff),
        untracked: { ...untrackedDiff, changedFiles: untrackedFilesResult.stdout.split('\0').filter(Boolean).length },
        uncommitted: { ...diff, changedFiles: changed.changedFiles },
      });

      return {
        folder,
        ...(repository ? { repository } : {}),
        ...(githubRepository ? { githubRepository } : {}),
        ...(repositoryProvider ? { repositoryProvider } : {}),
        ...branch,
        ...diff,
        changedFiles: changed.changedFiles,
        hasUntracked: changed.hasUntracked,
        ahead: branch.ahead ?? 0,
        behind: branch.behind ?? 0,
        state: isDirty ? 'dirty' : 'clean',
        diffCatalog,
        updatedAt,
      };
    } catch (error) {
      return {
        folder,
        ahead: 0,
        behind: 0,
        changedFiles: 0,
        addedLines: 0,
        removedLines: 0,
        hasUntracked: false,
        state: 'unknown',
        updatedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async diff(folder: string, target: Exclude<AgentGitDiffTarget, { type: 'turn' }> = { type: 'uncommitted' }): Promise<AgentGitDiff> {
    if (target.type === 'branch') {
      const workflow = await this.workflow(folder);
      if (!workflow.branch) throw new Error('Check out a branch before viewing branch changes.');
      const baseRef = target.baseRef ?? await this.resolveBaseRef(folder, workflow.branch, workflow.remote);
      await this.assertCommitRef(folder, baseRef);
      const mergeBase = (await this.runGit(folder, ['merge-base', 'HEAD', baseRef])).stdout.trim();
      const [tracked, trackedNumstat, untracked] = await Promise.all([
        this.runGit(folder, ['diff', '--no-ext-diff', mergeBase, '--']),
        this.runGit(folder, ['diff', '--numstat', mergeBase, '--']),
        this.untrackedDiff(folder),
      ]);
      return diffResult({ ...target, baseRef }, joinDiffOutputs([tracked.stdout, untracked.diff]), combineSummaries(parseNumstatSummary(trackedNumstat.stdout), untracked.summary));
    }

    if (target.type === 'commit') {
      await this.assertCommitRef(folder, target.sha);
      const [diff, numstat] = await Promise.all([
        this.runGit(folder, ['show', '--format=', '--no-ext-diff', target.sha, '--']),
        this.runGit(folder, ['show', '--format=', '--numstat', target.sha, '--']),
      ]);
      return diffResult(target, diff.stdout, parseNumstatSummary(numstat.stdout));
    }

    const sections = await this.diffSections(folder);
    const selected = target.type === 'staged'
      ? sections.filter((section) => section.scope === 'staged')
      : target.type === 'unstaged'
        ? sections.filter((section) => section.scope !== 'staged')
        : sections;
    const trackedSections = selected.filter((section) => section.scope !== 'untracked');
    const untracked = sections.find((section) => section.scope === 'untracked');
    const diff = target.type === 'uncommitted'
      ? joinDiffOutputs([
        (await this.runGit(folder, ['diff', 'HEAD', '--no-ext-diff', '--']).catch(() => ({ stdout: joinDiffOutputs(trackedSections.map((section) => section.diff)) }))).stdout,
        untracked?.diff ?? '',
      ])
      : joinDiffOutputs(selected.map((section) => section.diff));
    const numstat = target.type === 'uncommitted'
      ? await this.runGit(folder, ['diff', 'HEAD', '--numstat', '--']).then((result) => parseNumstatSummary(result.stdout)).catch(() => summaryFromSections(trackedSections))
      : summaryFromSections(selected);
    const summary = target.type === 'uncommitted' && untracked
      ? combineSummaries(numstat, summaryFromSections([untracked]))
      : numstat;
    return { target, summary, diff, sections: selected };
  }

  async diffSections(folder: string): Promise<AgentGitDiffSection[]> {
    const [staged, unstaged, untrackedFiles] = await Promise.all([
      this.runGit(folder, ['diff', '--cached', '--no-ext-diff', '--']),
      this.runGit(folder, ['diff', '--no-ext-diff', '--']),
      this.runGit(folder, ['ls-files', '--others', '--exclude-standard', '-z', '--']),
    ]);
    const untrackedDiffs: string[] = [];

    for (const file of untrackedFiles.stdout.split('\0').filter(Boolean)) {
      const result = await this.runGit(folder, [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        file,
      ]);
      untrackedDiffs.push(result.stdout);
    }

    return [
      { scope: 'staged', diff: staged.stdout },
      { scope: 'unstaged', diff: unstaged.stdout },
      { scope: 'untracked', diff: joinDiffOutputs(untrackedDiffs) },
    ];
  }

  private async diffCatalog(
    folder: string,
    input: {
      branch?: string;
      remote?: string;
      staged: AgentGitDiffSummary;
      unstaged: AgentGitDiffSummary;
      untracked: AgentGitDiffSummary;
      uncommitted: AgentGitDiffSummary;
    },
  ): Promise<AgentGitDiffCatalog> {
    let branch: (AgentGitDiffSummary & { baseRef: string }) | undefined;
    let commits: AgentGitCommitSummary[] = [];
    if (input.branch) {
      try {
        const baseRef = await this.resolveBaseRef(folder, input.branch, input.remote);
        const mergeBase = (await this.runGit(folder, ['merge-base', 'HEAD', baseRef])).stdout.trim();
        const [branchNumstat, commitLog] = await Promise.all([
          this.runGit(folder, ['diff', '--numstat', mergeBase, '--']),
          this.runGit(folder, ['log', '--max-count=20', '--format=%x1e%H%x1f%h%x1f%s', '--numstat', `${baseRef}..HEAD`, '--']),
        ]);
        branch = { baseRef, ...combineSummaries(parseNumstatSummary(branchNumstat.stdout), input.untracked) };
        commits = parseCommitSummaries(commitLog.stdout);
      } catch {
        // Repositories without a conventional base still expose working-tree comparisons.
      }
    }
    return {
      defaultTarget: branch ? { type: 'branch', baseRef: branch.baseRef } : { type: 'uncommitted' },
      ...(branch ? { branch } : {}),
      uncommitted: input.uncommitted,
      unstaged: input.unstaged,
      staged: input.staged,
      commits,
    };
  }

  private async untrackedDiff(folder: string): Promise<{ diff: string; summary: AgentGitDiffSummary }> {
    const paths = (await this.runGit(folder, ['ls-files', '--others', '--exclude-standard', '-z', '--'])).stdout.split('\0').filter(Boolean);
    const diffs: string[] = [];
    for (const file of paths) {
      diffs.push((await this.runGit(folder, ['diff', '--no-index', '--no-ext-diff', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file])).stdout);
    }
    return { diff: joinDiffOutputs(diffs), summary: { ...await untrackedNumstat(this.runGit, folder, paths), changedFiles: paths.length } };
  }

  private async assertCommitRef(folder: string, ref: string): Promise<void> {
    if (!ref.trim() || ref.startsWith('-')) throw new Error('Enter a valid Git reference.');
    await this.runGit(folder, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  }

  async commitMessageContext(
    folder: string,
    input: { includeUnstaged: boolean; includeUntracked: boolean },
  ): Promise<AgentGitGenerationContext> {
    const sections = await this.diffSections(folder);
    const selected = sections.filter((section) => (
      section.scope === 'staged'
      || (section.scope === 'unstaged' && input.includeUnstaged)
      || (section.scope === 'untracked' && input.includeUntracked)
    ) && section.diff.trim());
    if (selected.length === 0) throw new Error('There are no selected changes to describe.');
    return {
      context: boundedGenerationContext(selected.map((section) => (
        `## ${section.scope} changes\n${section.diff.trim()}`
      )).join('\n\n')),
    };
  }

  async pullRequestMessageContext(folder: string): Promise<AgentGitGenerationContext> {
    const { baseRef, commits, stat, diff } = await this.pullRequestChanges(folder);
    return {
      baseRef,
      context: boundedGenerationContext([
        `## Base\n${baseRef}`,
        `## Commits\n${commits || '(none)'}`,
        `## Diff stat\n${stat || '(none)'}`,
        `## Diff\n${diff}`,
      ].join('\n\n')),
    };
  }

  async assertPullRequestChanges(folder: string): Promise<void> {
    await this.pullRequestChanges(folder);
  }

  private async pullRequestChanges(folder: string): Promise<{
    baseRef: string;
    commits: string;
    stat: string;
    diff: string;
  }> {
    const workflow = await this.workflow(folder);
    const requestName = workflow.repositoryProvider === 'gitlab' ? 'merge request' : 'pull request';
    if (!workflow.branch || workflow.detached) throw new Error(`Create or check out a branch before generating a ${requestName}.`);
    if (isIntegrationBranch(workflow.branch)) throw new Error(`Create a feature branch before generating a ${requestName}.`);
    const baseRef = await this.resolveBaseRef(folder, workflow.branch, workflow.remote);
    const [commits, stat, diff] = await Promise.all([
      this.runGit(folder, ['log', '--format=%h %s%n%b', `${baseRef}..HEAD`]),
      this.runGit(folder, ['diff', '--stat', `${baseRef}...HEAD`, '--']),
      this.runGit(folder, ['diff', '--no-ext-diff', `${baseRef}...HEAD`, '--']),
    ]);
    if (!diff.stdout.trim()) {
      throw new AppError(
        workflow.repositoryProvider === 'gitlab' ? 'git.mergeRequestChangesRequired' : 'git.pullRequestChangesRequired',
        `This branch has no committed changes to include. Commit your work before creating a ${requestName}.`,
      );
    }
    return {
      baseRef,
      commits: commits.stdout.trim(),
      stat: stat.stdout.trim(),
      diff: diff.stdout.trim(),
    };
  }

  async workflow(folder: string): Promise<Omit<AgentGitWorkflow, 'githubConnected' | 'existingPullRequest'>> {
    const [root, branch, upstream, remote, status, branchStatusResult, stagedNumstat, unstagedNumstat, worktreeList, head] = await Promise.all([
      this.runGit(folder, ['rev-parse', '--show-toplevel']),
      this.runGit(folder, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['remote']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['status', '--porcelain=v1', '-z']),
      this.runGit(folder, ['status', '--porcelain=v1', '--branch']),
      this.runGit(folder, ['diff', '--cached', '--numstat', '--']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['diff', '--numstat', '--']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['worktree', 'list', '--porcelain']).catch(() => ({ stdout: '' })),
      this.runGit(folder, ['rev-parse', '--verify', 'HEAD']).catch(() => ({ stdout: '' })),
    ]);
    const remotes = remote.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const trackedRemote = upstream.stdout.trim().split('/')[0];
    const remoteName = (trackedRemote && remotes.includes(trackedRemote) ? trackedRemote : undefined)
      ?? (remotes.includes('origin') ? 'origin' : remotes[0]);
    const remoteUrl = remoteName
      ? sanitizeGitRemoteUrl((await this.runGit(folder, ['remote', 'get-url', remoteName])).stdout)
      : undefined;
    const files = parsePorcelainFiles(status.stdout);
    const branchStatus = parseBranchStatus(branchStatusResult.stdout);
    const stagedDiff = parseNumstat(stagedNumstat.stdout);
    const unstagedDiff = parseNumstat(unstagedNumstat.stdout);
    const untrackedDiff = await untrackedNumstat(this.runGit, folder, files.filter((file) => file.indexStatus === '?').map((file) => file.path));
    const repositoryFolder = root.stdout.trim();
    const worktrees = parseWorktrees(worktreeList.stdout);
    const currentWorktreeIndex = worktrees.findIndex((item) => resolve(item.path) === resolve(repositoryFolder));
    const baseWorktree = currentWorktreeIndex > 0 ? selectMergeTarget(worktrees, repositoryFolder) : undefined;
    const currentBranch = branch.stdout.trim();
    const [baseUpdateRequired, baseWorktreeDirty] = await Promise.all([
      baseWorktree?.branch && currentBranch
        ? this.runGit(folder, ['merge-base', '--is-ancestor', baseWorktree.branch, currentBranch]).then(() => false, () => true)
        : undefined,
      baseWorktree
        ? this.runGit(baseWorktree.path, ['status', '--porcelain=v1', '-z']).then((result) => Boolean(result.stdout))
        : undefined,
    ]);
    const identity = remoteUrl ? canonicalGitRemoteIdentity(remoteUrl) : undefined;
    const repositoryProvider = identity?.startsWith('gitlab.com/') ? 'gitlab' : identity?.startsWith('github.com/') ? 'github' : undefined;
    const repository = repositoryProvider === 'gitlab' ? identity! : repositoryProvider === 'github' ? identity!.slice(11) : fileName(repositoryFolder);
    return {
      repository,
      ...(head.stdout.trim() ? { headSha: head.stdout.trim() } : {}),
      ...(repositoryProvider ? { repositoryProvider } : {}),
      folder: repositoryFolder,
      isLinkedWorktree: currentWorktreeIndex > 0,
      ...(baseWorktree?.branch ? { baseBranch: baseWorktree.branch } : {}),
      ...(baseUpdateRequired !== undefined ? { baseUpdateRequired } : {}),
      ...(baseWorktreeDirty !== undefined ? { baseWorktreeDirty } : {}),
      ...(currentBranch ? { branch: currentBranch } : {}),
      detached: !currentBranch,
      ...(remoteName ? { remote: remoteName } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(upstream.stdout.trim() ? { upstream: upstream.stdout.trim() } : {}),
      ahead: branchStatus.ahead ?? 0,
      behind: branchStatus.behind ?? 0,
      stagedAddedLines: stagedDiff.addedLines,
      stagedRemovedLines: stagedDiff.removedLines,
      unstagedAddedLines: unstagedDiff.addedLines,
      unstagedRemovedLines: unstagedDiff.removedLines,
      untrackedAddedLines: untrackedDiff.addedLines,
      untrackedRemovedLines: untrackedDiff.removedLines,
      files,
      stagedFiles: files.filter((file) => file.indexStatus !== ' ' && file.indexStatus !== '?').map((file) => file.path),
      unstagedFiles: files.filter((file) => file.worktreeStatus !== ' ' || file.indexStatus === '?').map((file) => file.path),
    };
  }

  async stage(folder: string, paths: string[]): Promise<void> {
    if (paths.length === 0) throw new Error('Select at least one file to stage.');
    if (paths.some((path) => !path.trim() || path.startsWith('/') || path.split(/[\\/]/).includes('..'))) {
      throw new Error('Stage paths must stay inside the repository.');
    }
    await this.runGit(folder, ['add', '--', ...paths]);
  }

  async commit(folder: string, message: string): Promise<void> {
    const normalized = message.trim();
    if (!normalized) throw new Error('Enter a commit message.');
    await this.runGit(folder, ['commit', '-m', normalized]);
  }

  async revert(folder: string, includeUntracked: boolean): Promise<void> {
    const root = (await this.runGit(folder, ['rev-parse', '--show-toplevel'])).stdout.trim();
    // Validate HEAD before deleting anything; an unborn repository has nothing to restore.
    await this.runGit(root, ['rev-parse', '--verify', 'HEAD']);
    // Clean first so the current ignore rules still protect local files. A single
    // force flag deliberately leaves nested repositories alone; never use -x.
    if (includeUntracked) await this.runGit(root, ['clean', '-fd', '--', '.']);
    await this.runGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', '.']);
  }

  async push(folder: string, remote: string, branch: string, setUpstream: boolean): Promise<void> {
    await this.runGit(folder, setUpstream
      ? ['push', '--set-upstream', remote, branch]
      : ['push', remote, branch]);
  }

  async createBranch(folder: string, name: string, createWorktree = false, pullRequestNumber?: number, expectedHeadSha?: string): Promise<string> {
    const normalized = name.trim();
    if (!normalized) throw new Error('Enter a branch name.');
    if (normalized.startsWith('-')) throw new Error('Enter a valid branch name.');
    try {
      await this.runGit(folder, ['check-ref-format', '--branch', normalized]);
    } catch {
      throw new Error('Enter a valid branch name.');
    }
    let startPoint: string | undefined;
    if (pullRequestNumber !== undefined) {
      if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) throw new Error('Enter a valid request number.');
      const workflow = await this.workflow(folder);
      if (!workflow.remote || !workflow.repositoryProvider) throw new Error('Choose a GitHub or GitLab.com remote before checking out a request.');
      const ref = workflow.repositoryProvider === 'gitlab' ? `refs/merge-requests/${pullRequestNumber}/head` : `pull/${pullRequestNumber}/head`;
      await this.runGit(folder, ['fetch', workflow.remote, ref]);
      const fetchedHead = (await this.runGit(folder, ['rev-parse', 'FETCH_HEAD'])).stdout.trim();
      if (!/^[a-f0-9]{40,64}$/i.test(fetchedHead) || expectedHeadSha && fetchedHead !== expectedHeadSha) throw new Error('The request head changed. Refresh the request and retry checkout.');
      startPoint = fetchedHead;
    }
    if (createWorktree) {
      if (!this.createWorktree) throw new Error('Worktree creation is not configured.');
      const worktree = await this.createWorktree({
        repoPath: folder,
        branchName: normalized,
        reuseExisting: true,
        ...(startPoint ? { startPoint } : {}),
      });
      if (startPoint) await this.runGit(worktree.path, ['merge', '--ff-only', startPoint]);
      return worktree.path;
    }
    const branchExists = await this.localBranchExists(folder, normalized);
    if (branchExists) {
      await this.runGit(folder, ['switch', normalized]);
      if (startPoint) await this.runGit(folder, ['merge', '--ff-only', startPoint]);
    } else {
      const remoteBranch = startPoint ? undefined : await this.remoteBranch(folder, normalized);
      await this.runGit(folder, ['switch', '-c', normalized, ...(startPoint ? [startPoint] : remoteBranch ? [remoteBranch] : [])]);
    }
    return folder;
  }

  async deleteLinkedWorktree(folder: string, deleteRemoteBranch = false, expectedHeadSha?: string, discardChanges = false, expectedIdentity?: Pick<AgentPullRequestTracking, 'provider' | 'repository' | 'branch'>): Promise<void> {
    const { current, target } = await this.linkedWorktreeDeletionPlan(folder, deleteRemoteBranch, expectedHeadSha, discardChanges, expectedIdentity);

    if (deleteRemoteBranch) {
      const branch = current.upstream!.slice(current.remote!.length + 1);
      // A tracked request grants cleanup of its recorded head, never newer remote work.
      await this.runGit(target.path, expectedHeadSha
        ? ['push', `--force-with-lease=refs/heads/${branch}:${expectedHeadSha}`, current.remote!, `:refs/heads/${branch}`]
        : ['push', current.remote!, '--delete', branch]);
    }
    await this.runGit(target.path, ['worktree', 'remove', ...(discardChanges ? ['--force'] : []), current.folder]);
    await this.runGit(target.path, ['branch', '-D', current.branch!]);
  }

  async validateLinkedWorktreeDeletion(folder: string, deleteRemoteBranch = false, expectedHeadSha?: string, discardChanges = false, expectedIdentity?: Pick<AgentPullRequestTracking, 'provider' | 'repository' | 'branch'>): Promise<void> {
    await this.linkedWorktreeDeletionPlan(folder, deleteRemoteBranch, expectedHeadSha, discardChanges, expectedIdentity);
  }

  private async linkedWorktreeDeletionPlan(folder: string, deleteRemoteBranch: boolean, expectedHeadSha?: string, discardChanges = false, expectedIdentity?: Pick<AgentPullRequestTracking, 'provider' | 'repository' | 'branch'>): Promise<{
    current: Omit<AgentGitWorkflow, 'githubConnected' | 'existingPullRequest'>;
    target: { path: string; branch?: string };
  }> {
    const current = await this.workflow(folder);
    if (!current.isLinkedWorktree) throw new Error('The current folder is not a linked worktree.');
    if (!current.branch || current.detached) throw new Error('The linked worktree does not have a local branch to delete.');
    if (expectedIdentity && (current.branch !== expectedIdentity.branch || current.repository !== expectedIdentity.repository || current.repositoryProvider !== expectedIdentity.provider)) {
      throw new Error('The worktree repository or branch no longer matches the tracked request. Keep it and review its current work.');
    }
    if (current.files.length > 0 && !discardChanges) throw new Error('Commit or discard the worktree changes before deleting it.');
    if (expectedHeadSha) {
      const headSha = (await this.runGit(folder, ['rev-parse', 'HEAD'])).stdout.trim();
      if (headSha !== expectedHeadSha) {
        throw new Error('This branch contains commits that are not part of the tracked request.');
      }
    }

    const worktrees = parseWorktrees((await this.runGit(folder, ['worktree', 'list', '--porcelain'])).stdout);
    const target = selectMergeTarget(worktrees, current.folder);
    if (!target) throw new Error('A primary worktree is required before deleting this worktree.');

    if (deleteRemoteBranch) {
      const upstream = matchingBranchUpstream(current.branch, current.upstream, current.baseBranch ?? target.branch);
      if (!current.remote || !upstream?.startsWith(`${current.remote}/`)) {
        throw new Error('The branch does not have a remote branch to delete.');
      }
      if (expectedIdentity) {
        const pushUrl = (await this.runGit(target.path, ['remote', 'get-url', '--push', current.remote])).stdout.trim();
        const expectedRepository = expectedIdentity.provider === 'github' ? `github.com/${expectedIdentity.repository}` : expectedIdentity.repository;
        if (canonicalGitRemoteIdentity(pushUrl) !== expectedRepository) {
          throw new Error('The push repository no longer matches the tracked request. Keep the remote branch and review its push destination.');
        }
      }
    }
    return { current, target };
  }

  private async localBranchExists(folder: string, branch: string): Promise<boolean> {
    try {
      await this.runGit(folder, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async remoteBranch(folder: string, branch: string): Promise<string | undefined> {
    const refs = (await this.runGit(folder, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']))
      .stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value && !value.endsWith('/HEAD'));
    return refs.find((ref) => ref.endsWith(`/${branch}`));
  }

  async mergeTarget(folder: string): Promise<string> {
    const current = await this.workflow(folder);
    const worktrees = parseWorktrees((await this.runGit(folder, ['worktree', 'list', '--porcelain'])).stdout);
    const target = selectMergeTarget(worktrees, current.folder);
    if (!target) throw new Error('A base worktree is required before merging.');
    return target.path;
  }

  async updateFromBase(folder: string, allowDirty = false): Promise<{ baseBranch: string; branch: string; conflicts: string[] }> {
    const current = await this.workflow(folder);
    if (!current.isLinkedWorktree) throw new Error('The current folder is not a linked worktree.');
    if (!current.branch || current.detached) throw new Error('Create or check out a branch before updating it.');
    if (current.files.length > 0 && !allowDirty) {
      throw new Error('Commit your changes before updating from the base branch.');
    }
    const worktrees = parseWorktrees((await this.runGit(folder, ['worktree', 'list', '--porcelain'])).stdout);
    const base = selectMergeTarget(worktrees, current.folder);
    if (!base?.branch) throw new Error('Check out the base branch before updating this worktree.');
    const strategy = this.settings().update;
    if (strategy === 'rebase') assertRebaseCanProceed(current.files, 'updating');
    try {
      await this.runGit(folder, strategy === 'rebase'
        ? ['-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', base.branch]
        : ['merge', strategy === 'ff-only' ? '--ff-only' : '--ff', '--no-edit', '--no-autostash', base.branch]);
      return { baseBranch: base.branch, branch: current.branch, conflicts: [] };
    } catch (error) {
      const conflicts = (await this.runGit(folder, ['diff', '--name-only', '--diff-filter=U', '-z'])
        .catch(() => ({ stdout: '' }))).stdout.split('\0').filter(Boolean);
      if (conflicts.length === 0) throw error;
      return { baseBranch: base.branch, branch: current.branch, conflicts };
    }
  }

  async pull(folder: string, allowDirty = false): Promise<{ upstream: string; branch: string; conflicts: string[] }> {
    const current = await this.workflow(folder);
    if (!current.branch || current.detached) throw new Error('Check out a branch before pulling.');
    if (!current.upstream) throw new Error('Set an upstream branch before pulling.');
    const readConflicts = async () => (await this.runGit(folder, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout.split('\0').filter(Boolean);
    if ((await readConflicts()).length > 0) throw new Error('Resolve the existing conflicts before pulling.');
    if (current.files.length > 0 && !allowDirty) throw new Error('Commit your changes before pulling.');
    const result = { upstream: current.upstream, branch: current.branch, conflicts: [] as string[] };
    const strategyFlags = await this.pullStrategyFlags(folder, current.branch);
    if (strategyFlags.some((flag) => flag === '--rebase' || flag.startsWith('--rebase='))) assertRebaseCanProceed(current.files, 'pulling');
    try {
      await this.runGit(folder, ['-c', 'rebase.updateRefs=false', 'pull', ...strategyFlags, '--no-edit', '--no-autostash']);
      return result;
    } catch (error) {
      const conflicts = await readConflicts();
      if (conflicts.length === 0) throw error;
      return { ...result, conflicts };
    }
  }

  private async pullStrategyFlags(folder: string, branch: string): Promise<string[]> {
    const strategy = this.settings().pull;
    if (strategy === 'merge') return ['--no-rebase', '--ff'];
    if (strategy === 'rebase') return ['--rebase', '--ff'];
    if (strategy === 'ff-only') return ['--no-rebase', '--ff-only'];

    const config = async (key: string) => (await this.runGit(folder, ['config', '--get', key]).catch(() => ({ stdout: '' }))).stdout.trim();
    const rebase = await config(`branch.${branch}.rebase`) || await config('pull.rebase');
    const ff = await config('pull.ff');
    if (rebase && !['true', 'false', 'merges', 'm'].includes(rebase)) throw new Error('Unsupported Git rebase configuration. Choose a Pull strategy in Settings.');
    if (ff && !['true', 'false', 'only'].includes(ff)) throw new Error('Unsupported Git fast-forward configuration. Choose a Pull strategy in Settings.');
    if (ff === 'only' || (!rebase && !ff)) return ['--no-rebase', '--ff-only'];
    return [rebase === 'true' ? '--rebase' : rebase === 'merges' || rebase === 'm' ? '--rebase=merges' : '--no-rebase', ff === 'false' ? '--no-ff' : '--ff'];
  }

  async merge(folder: string, strategy: 'merge' | 'squash', deleteBranch: boolean, deleteWorktree: boolean, commitMessage?: string): Promise<AgentGitMergeResult> {
    const normalizedCommitMessage = commitMessage?.trim();
    if (strategy === 'squash' && !normalizedCommitMessage) throw new Error('Enter a squash commit message.');
    const current = await this.workflow(folder);
    if (!current.branch || current.detached) throw new Error('Create or check out a branch before merging.');
    if (deleteWorktree && !current.isLinkedWorktree) throw new Error('The current folder is not a linked worktree.');
    if (deleteBranch && !deleteWorktree) throw new Error('Remove the linked worktree before deleting its branch.');
    const worktrees = parseWorktrees((await this.runGit(folder, ['worktree', 'list', '--porcelain'])).stdout);
    const target = selectMergeTarget(worktrees, current.folder);
    let targetFolder = target?.path;
    let targetBranch = target?.branch;
    let switchTargetBranch = false;
    if (!targetFolder) {
      if (current.isLinkedWorktree) throw new Error('A base worktree is required before merging.');
      const branches = (await this.runGit(folder, ['branch', '--format=%(refname:short)'])).stdout
        .split(/\r?\n/)
        .map((branch) => branch.trim())
        .filter(Boolean);
      const baseBranch = integrationBranches.find((branch) => branch !== current.branch && branches.includes(branch));
      if (!baseBranch) throw new Error('Create a local base branch before merging.');
      targetFolder = current.folder;
      targetBranch = baseBranch;
      switchTargetBranch = true;
    }
    if (!targetBranch) throw new Error('Check out the base branch before merging.');
    const targetDirty = Boolean((await this.runGit(targetFolder, ['status', '--porcelain=v1', '-z'])).stdout);
    if (targetDirty) throw new Error(`Commit changes in ${targetBranch} before merging.`);
    const branchIsCurrent = await this.runGit(
      targetFolder,
      ['merge-base', '--is-ancestor', targetBranch, current.branch],
    ).then(() => true, () => false);
    if (!branchIsCurrent) {
      throw new Error(
        `${current.branch} is not up to date with ${targetBranch}. Update the branch with ${targetBranch} before merging.`,
      );
    }
    if (switchTargetBranch) await this.runGit(current.folder, ['switch', targetBranch]);
    await this.runGit(targetFolder, strategy === 'squash' ? ['merge', '--squash', current.branch] : ['merge', '--no-ff', current.branch]);
    if (strategy === 'squash') await this.runGit(targetFolder, ['commit', '-m', normalizedCommitMessage!]);
    let warning = deleteWorktree
      ? await this.removeMergedWorktree(targetFolder, current.folder)
      : undefined;
    if (deleteBranch) {
      let sourceSha: string;
      try {
        // Git's -d checks the upstream, which may lag behind the successful local merge.
        if (strategy === 'merge') {
          await this.runGit(targetFolder, ['merge-base', '--is-ancestor', current.branch, 'HEAD']);
        }
        sourceSha = (await this.runGit(targetFolder, ['rev-parse', `refs/heads/${current.branch}`])).stdout.trim();
        await this.runGit(targetFolder, ['branch', '-D', current.branch]);
      } catch {
        warning = { type: 'branchRetained', branch: current.branch, ...(warning ? { folder: warning.folder } : {}) };
        return { targetFolder, warning };
      }
      try {
        await this.deleteMergedOriginBranch(targetFolder, current.branch, sourceSha);
      } catch {
        warning = { type: 'branchRetained', branch: `origin/${current.branch}`, ...(warning ? { folder: warning.folder } : {}) };
      }
    }
    return { targetFolder, ...(warning ? { warning } : {}) };
  }

  private async deleteMergedOriginBranch(folder: string, branch: string, sourceSha: string): Promise<void> {
    const remotes = (await this.runGit(folder, ['remote'])).stdout.trim().split(/\r?\n/u);
    if (!remotes.includes('origin')) return;
    // Inspect the push destination, not a potentially different fetch URL.
    const urls = (await this.runGit(folder, ['remote', 'get-url', '--push', '--all', 'origin'])).stdout.trim().split(/\r?\n/u);
    if (urls.length !== 1 || !urls[0]) throw new Error('Ambiguous origin push destination.');
    const url = urls[0];
    const ref = `refs/heads/${branch}`;
    const lines = (await this.runGit(folder, ['ls-remote', '--symref', '--', url, 'HEAD', ref])).stdout.split(/\r?\n/u);
    if (lines.includes(`ref: ${ref}\tHEAD`)) throw new Error('Retain the origin default branch.');
    const sha = lines.find((line) => line.endsWith(`\t${ref}`))?.split('\t')[0];
    if (sha) {
      if (!/^[a-f0-9]{40,64}$/u.test(sha)) throw new Error('Invalid origin branch head.');
      // Preserve commits that were not part of this merge, including squash merges.
      await this.runGit(folder, ['merge-base', '--is-ancestor', sha, sourceSha]);
      await this.runGit(folder, ['push', `--force-with-lease=${ref}:${sha}`, '--', url, `:${ref}`]);
    }
    // Also clear stale tracking refs when origin already removed the branch.
    await this.runGit(folder, ['update-ref', '-d', `refs/remotes/origin/${branch}`]);
  }

  private async removeMergedWorktree(targetFolder: string, worktreeFolder: string): Promise<NonNullable<AgentGitWorkflow['warning']> | undefined> {
    try {
      await this.runGit(targetFolder, ['worktree', 'remove', worktreeFolder]);
      return undefined;
    } catch (error) {
      const worktrees = parseWorktrees((await this.runGit(targetFolder, ['worktree', 'list', '--porcelain'])).stdout);
      const remainsRegistered = worktrees.some((worktree) => resolve(worktree.path) === resolve(worktreeFolder));
      if (remainsRegistered) throw error;
      return { type: 'worktreeFolderRetained', folder: worktreeFolder };
    }
  }

  private async resolveBaseRef(folder: string, branch: string, remote?: string): Promise<string> {
    if (remote) {
      const remoteHead = (await this.runGit(folder, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`])
        .catch(() => ({ stdout: '' }))).stdout.trim();
      if (remoteHead && remoteHead !== `${remote}/${branch}`) return remoteHead;
    }
    const candidates = [
      ...(remote ? integrationBranches.map((name) => `${remote}/${name}`) : []),
      ...integrationBranches,
    ].filter((candidate) => candidate !== branch);
    for (const candidate of candidates) {
      const exists = await this.runGit(folder, ['rev-parse', '--verify', '--quiet', candidate])
        .then(() => true, () => false);
      if (exists) return candidate;
    }
    throw new Error('A main, master, develop, development, or trunk base branch is required.');
  }
}

const integrationBranches = ['main', 'master', 'develop', 'development', 'trunk'] as const;
const maxGenerationContextLength = 60_000;

function boundedGenerationContext(value: string): string {
  if (value.length <= maxGenerationContextLength) return value;
  return `${value.slice(0, maxGenerationContextLength)}\n\n[diff truncated by ${product.name}]`;
}

function isIntegrationBranch(branch: string): boolean {
  return integrationBranches.some((candidate) => candidate === branch);
}

function selectMergeTarget(worktrees: Array<{ path: string; branch?: string }>, currentFolder: string): { path: string; branch?: string } | undefined {
  return worktrees.find((item) => item.path !== currentFolder && integrationBranches.some((branch) => item.branch === branch))
    ?? worktrees.find((item) => item.path !== currentFolder);
}

function parseWorktrees(output: string): Array<{ path: string; branch?: string }> {
  const records = output.split(/\n\n+/).map((record) => record.split(/\r?\n/)).filter((lines) => lines[0]?.startsWith('worktree '));
  return records.map((lines) => ({ path: lines[0]!.slice('worktree '.length), branch: lines.find((line) => line.startsWith('branch '))?.slice('branch refs/heads/'.length) }));
}

// Git cannot rebase over tracked changes without an autostash; untracked files are fine.
function assertRebaseCanProceed(files: AgentGitFile[], action: 'pulling' | 'updating'): void {
  if (files.some((file) => file.indexStatus !== '?' && file.indexStatus !== '!')) {
    throw new Error(`Commit or discard your tracked changes before ${action} with rebase, or choose another strategy in Settings.`);
  }
}

export function parsePorcelainFiles(output: string): AgentGitFile[] {
  const entries = output.split('\0').filter(Boolean);
  const files: AgentGitFile[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const indexStatus = entry[0] ?? ' ';
    const worktreeStatus = entry[1] ?? ' ';
    let path = entry.slice(3);
    if ((indexStatus === 'R' || indexStatus === 'C') && entries[index + 1]) path = entries[++index]!;
    files.push({ path, indexStatus, worktreeStatus });
  }
  return files;
}

function fileName(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? value;
}

function joinDiffOutputs(diffs: string[]): string {
  let output = '';
  for (const diff of diffs) {
    if (!diff) continue;
    if (output && !output.endsWith('\n')) output += '\n';
    output += diff;
  }
  return output;
}

function diffResult(target: AgentGitDiffTarget, diff: string, summary: AgentGitDiffSummary): AgentGitDiff {
  return { target, summary, diff, sections: [] };
}

function summaryFromSections(sections: AgentGitDiffSection[]): AgentGitDiffSummary {
  return sections.reduce((total, section) => combineSummaries(total, parseUnifiedDiffSummary(section.diff)), emptyDiffSummary());
}

function parseUnifiedDiffSummary(diff: string): AgentGitDiffSummary {
  let addedLines = 0;
  let removedLines = 0;
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) files.add(line);
    else if (line.startsWith('+') && !line.startsWith('+++')) addedLines += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removedLines += 1;
  }
  return { addedLines, removedLines, changedFiles: files.size };
}

function combineSummaries(...summaries: Array<Pick<AgentGitDiffSummary, 'addedLines' | 'removedLines'> & Partial<Pick<AgentGitDiffSummary, 'changedFiles'>>>): AgentGitDiffSummary {
  return summaries.reduce<AgentGitDiffSummary>((total, summary) => ({
    addedLines: total.addedLines + summary.addedLines,
    removedLines: total.removedLines + summary.removedLines,
    changedFiles: total.changedFiles + (summary.changedFiles ?? 0),
  }), emptyDiffSummary());
}

function emptyDiffSummary(): AgentGitDiffSummary {
  return { addedLines: 0, removedLines: 0, changedFiles: 0 };
}

export function parseCommitSummaries(output: string): AgentGitCommitSummary[] {
  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [header = '', ...numstat] = record.split(/\r?\n/u);
    const [sha = '', shortSha = '', subject = ''] = header.split('\x1f');
    return { sha, shortSha, subject, ...parseNumstatSummary(numstat.join('\n')) };
  }).filter((commit) => Boolean(commit.sha));
}

async function untrackedNumstat(runGit: AgentGitRunner, folder: string, paths: string[]): Promise<{ addedLines: number; removedLines: number }> {
  const results = await Promise.all(paths.map(async (filePath) => {
    try {
      return parseNumstat((await runGit(folder, ['diff', '--no-index', '--numstat', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', filePath])).stdout);
    } catch {
      return { addedLines: 0, removedLines: 0 };
    }
  }));
  return results.reduce((total, result) => ({ addedLines: total.addedLines + result.addedLines, removedLines: total.removedLines + result.removedLines }), { addedLines: 0, removedLines: 0 });
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      ...(args[0] === 'ls-remote' || (args[0] === 'push' && args[1]?.startsWith('--force-with-lease=')) ? {
        timeout: 30_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      } : {}),
    });
    return { stdout: result.stdout };
  } catch (error) {
    // `git diff --no-index` uses exit code 1 to report that files differ.
    if (args.includes('--no-index') && isExpectedDiffExit(error)) {
      return { stdout: error.stdout };
    }
    throw error;
  }
}

function isExpectedDiffExit(error: unknown): error is { code: 1; stdout: string } {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 1
    && 'stdout' in error
    && typeof error.stdout === 'string';
}

export function parseBranchStatus(output: string): Pick<AgentGitStatus, 'ahead' | 'behind' | 'branch' | 'upstream'> {
  const branchLine = output.split(/\r?\n/).find((line) => line.startsWith('## '));
  if (!branchLine) {
    return { ahead: 0, behind: 0 };
  }

  const content = branchLine.slice(3).trim();
  const [branchPart, trackingPart] = content.split('...');
  const branch = branchPart && branchPart !== 'HEAD (no branch)' ? branchPart : undefined;
  if (!trackingPart) {
    return {
      ...(branch ? { branch } : {}),
      ahead: 0,
      behind: 0,
    };
  }

  const [upstreamPart, detailPart] = trackingPart.split(' [');
  const ahead = Number(detailPart?.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(detailPart?.match(/behind (\d+)/)?.[1] ?? 0);

  return {
    ...(branch ? { branch } : {}),
    ...(upstreamPart ? { upstream: upstreamPart } : {}),
    ahead,
    behind,
  };
}

export function parseChangedFiles(output: string): Pick<AgentGitStatus, 'changedFiles' | 'hasUntracked'> {
  const lines = output.split(/\r?\n/).filter((line) => line && !line.startsWith('## '));
  return {
    changedFiles: lines.length,
    hasUntracked: lines.some((line) => line.startsWith('??')),
  };
}

export function parseNumstat(output: string): Pick<AgentGitStatus, 'addedLines' | 'removedLines'> {
  let addedLines = 0;
  let removedLines = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [added, removed] = line.split(/\s+/);
    addedLines += numericStat(added);
    removedLines += numericStat(removed);
  }

  return { addedLines, removedLines };
}

function parseNumstatSummary(output: string): AgentGitDiffSummary {
  return {
    ...parseNumstat(output),
    changedFiles: output.split(/\r?\n/u).filter((line) => line.trim()).length,
  };
}

function numericStat(value: string | undefined): number {
  if (!value || value === '-') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
