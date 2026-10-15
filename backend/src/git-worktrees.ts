import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CreateSourceWorktreeInput, SourceBranch, SourceWorktree } from '@workspace/core/contracts';

const execFileAsync = promisify(execFile);

type CommandRunner = {
  run: (command: string, args: string[], options: { cwd: string }) => Promise<{ stdout?: string }>;
};

export type GitWorktreeCreateInput = CreateSourceWorktreeInput & {
  startPoint?: string;
};

type GitWorktreeCreateResult = {
  worktree: SourceWorktree;
  created: boolean;
};

const defaultRunner: CommandRunner = {
  run: (command, args, options) => execFileAsync(command, args, options),
};

export async function readWorktreeHead(folder: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: folder });
  return stdout.trim();
}

export function suggestedSourceWorktreePath(repoPath: string, branchName: string): string {
  return path.join(
    path.dirname(repoPath),
    `${path.basename(repoPath)}-${slug(branchName)}`,
  );
}

export async function createSourceWorktree(
  input: GitWorktreeCreateInput,
  runner: CommandRunner = defaultRunner,
): Promise<SourceWorktree> {
  return (await createGitWorktree(input, runner)).worktree;
}

export async function createGitWorktree(
  input: GitWorktreeCreateInput,
  runner: CommandRunner = defaultRunner,
): Promise<GitWorktreeCreateResult> {
  const repoPath = input.repoPath.trim();
  const branchName = input.branchName.trim();
  if (!branchName) {
    throw new Error('Branch name is required.');
  }

  if (input.reuseExisting && !input.requireNewBranch) {
    const existing = (await listSourceWorktrees(repoPath, runner)).find((worktree) => worktree.name === branchName);
    if (existing) return { worktree: existing, created: false };
  }

  const worktreePath = input.destinationPath?.trim() || suggestedSourceWorktreePath(repoPath, branchName);
  const localBranch = await branchExists(runner, repoPath, `refs/heads/${branchName}`);
  if (localBranch && input.requireNewBranch) throw new Error('That branch already exists.');
  if (localBranch) {
    await runner.run('git', ['worktree', 'add', worktreePath, branchName], { cwd: repoPath });
    if (input.startPoint) {
      await runner.run('git', ['merge', '--ff-only', input.startPoint], { cwd: worktreePath });
    }
  } else {
    const baseBranch = input.baseBranch?.trim();
    let fetchedBase: string | undefined;
    if (input.fetchRemoteBranch) {
      const fetchBranch = input.requireNewBranch ? baseBranch : branchName;
      if (!fetchBranch) throw new Error('Base branch is required.');
      await runner.run('git', ['check-ref-format', `refs/heads/${fetchBranch}`], { cwd: repoPath });
      await runner.run('git', ['fetch', '--no-tags', '--', 'origin', `+refs/heads/${fetchBranch}:refs/remotes/origin/${fetchBranch}`], { cwd: repoPath });
      if (input.requireNewBranch) fetchedBase = `refs/remotes/origin/${fetchBranch}`;
    }
    const remoteBranch = input.startPoint ? undefined : await findRemoteBranch(runner, repoPath, branchName);
    if (remoteBranch && input.requireNewBranch) throw new Error('That branch already exists.');
    const startPoint = input.startPoint ?? fetchedBase ?? remoteBranch ?? (baseBranch
      ? await resolveBranchStartPoint(runner, repoPath, baseBranch)
      : undefined);
    await runner.run('git', remoteBranch
      ? ['worktree', 'add', '-b', branchName, worktreePath, remoteBranch]
      : [
          'worktree',
          'add',
          '-b',
          branchName,
          '--no-track',
          worktreePath,
          ...(startPoint ? [startPoint] : []),
        ], { cwd: repoPath });
  }

  return {
    worktree: {
      name: slug(path.basename(branchName)),
      path: worktreePath,
    },
    created: true,
  };
}

export async function listSourceBranches(
  repoPath: string,
  runner: CommandRunner = defaultRunner,
): Promise<SourceBranch[]> {
  const normalizedRepoPath = repoPath.trim();
  if (!normalizedRepoPath) throw new Error('Repository path is required.');

  const [refs, worktrees, defaultRef] = await Promise.all([
    runner.run('git', ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'], { cwd: normalizedRepoPath }),
    runner.run('git', ['worktree', 'list', '--porcelain'], { cwd: normalizedRepoPath }),
    runner.run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: normalizedRepoPath })
      .catch(() => ({ stdout: '' })),
  ]);
  return parseSourceBranches(refs.stdout ?? '', worktrees.stdout ?? '', defaultRef.stdout ?? '', normalizedRepoPath);
}

export function parseSourceBranches(
  refsOutput: string,
  worktreesOutput: string,
  defaultRefOutput: string,
  repoPath: string,
): SourceBranch[] {
  const worktreeByBranch = new Map(
    parseGitWorktreeList(worktreesOutput, repoPath).map((worktree) => [worktree.name, worktree.path]),
  );
  const names = new Set<string>();
  for (const rawRef of refsOutput.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
    if (rawRef.endsWith('/HEAD')) continue;
    if (rawRef.startsWith('refs/heads/')) names.add(rawRef.slice('refs/heads/'.length));
    else if (rawRef.startsWith('refs/remotes/')) names.add(rawRef.slice('refs/remotes/'.length).replace(/^[^/]+\//u, ''));
  }
  const explicitDefault = defaultRefOutput.trim().replace(/^[^/]+\//u, '');
  const fallbackDefault = names.has('main') ? 'main' : names.has('master') ? 'master' : '';
  const defaultBranch = explicitDefault || fallbackDefault;
  return [...names]
    .map((name): SourceBranch => ({
      name,
      isDefault: name === defaultBranch,
      ...(worktreeByBranch.get(name) ? { worktreePath: worktreeByBranch.get(name) } : {}),
    }))
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name));
}

export async function listSourceWorktrees(
  repoPath: string,
  runner: CommandRunner = defaultRunner,
): Promise<SourceWorktree[]> {
  const normalizedRepoPath = repoPath.trim();
  if (!normalizedRepoPath) {
    throw new Error('Repository path is required.');
  }

  const result = await runner.run('git', ['worktree', 'list', '--porcelain'], {
    cwd: normalizedRepoPath,
  });

  return parseGitWorktreeList(result.stdout ?? '', normalizedRepoPath);
}

export function parseGitWorktreeList(output: string, repoPath: string): SourceWorktree[] {
  return output
    .split(/\n(?=worktree )/u)
    .map((entry) => parseGitWorktreeEntry(entry, repoPath))
    .filter((entry): entry is SourceWorktree => entry !== null)
    .sort((left, right) => {
      if (left.path === repoPath) {
        return -1;
      }
      if (right.path === repoPath) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function parseGitWorktreeEntry(entry: string, repoPath: string): SourceWorktree | null {
  const lines = entry.split('\n').map((line) => line.trim()).filter(Boolean);
  const worktreePath = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length).trim();
  if (!worktreePath) {
    return null;
  }

  const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length).trim();
  const branchName = branch?.replace(/^refs\/heads\//u, '') ?? '';

  return {
    name: branchName || path.basename(worktreePath) || path.basename(repoPath),
    path: worktreePath,
  };
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'worktree';
}

async function branchExists(runner: CommandRunner, repoPath: string, ref: string): Promise<boolean> {
  try {
    await runner.run('git', ['show-ref', '--verify', '--quiet', ref], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

async function findRemoteBranch(runner: CommandRunner, repoPath: string, branchName: string): Promise<string | undefined> {
  const result = await runner.run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], { cwd: repoPath });
  return (result.stdout ?? '')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.endsWith(`/${branchName}`) && !value.endsWith('/HEAD'));
}

async function resolveBranchStartPoint(runner: CommandRunner, repoPath: string, branchName: string): Promise<string> {
  if (await branchExists(runner, repoPath, `refs/heads/${branchName}`)) {
    return branchName;
  }

  const remoteBranch = await findRemoteBranch(runner, repoPath, branchName);
  if (remoteBranch) {
    return remoteBranch;
  }

  throw new Error(`Base branch not found: ${branchName}`);
}
