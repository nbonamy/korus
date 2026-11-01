import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SourceRepository, SourceWorktree } from '@workspace/core/contracts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';

export function sourceFolderCandidates(): string[] {
  return [
    '~/src',
    '~/code',
    '~/dev',
    '~/sources',
    '~/projects',
    '~/repos',
    '~/source',
    '~/workspace',
    '~/workspaces',
    '~/git',
    '~/github',
    '~/Development',
    '~/work',
    '~/coding',
  ];
}

export async function detectSourceFolder(): Promise<string> {
  for (const candidate of sourceFolderCandidates()) {
    if (await sourceFolderPathExists(candidate)) {
      return candidate;
    }
  }
  return '';
}

export async function sourceFolderPathExists(folderPath: string): Promise<boolean> {
  try {
    return (await stat(resolveSourceFolderPath(folderPath))).isDirectory();
  } catch {
    return false;
  }
}

export async function scanSourceRepositories(sourceFolderPath: string): Promise<SourceRepository[]> {
  const sourceRoot = resolveSourceFolderPath(sourceFolderPath);
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const clones = new Map<string, SourceRepository>();
  const worktrees: Array<{ parentPath: string; worktree: SourceWorktree }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = path.join(sourceRoot, entry.name);
    const gitInfo = await readGitInfo(entryPath);
    if (!gitInfo) {
      continue;
    }

    if (gitInfo.kind === 'clone') {
      clones.set(entryPath, {
        name: entry.name,
        path: entryPath,
        ...(gitInfo.remoteIdentity ? { remoteIdentity: gitInfo.remoteIdentity } : {}),
        worktrees: [{
          name: gitInfo.branchName ?? entry.name,
          path: entryPath,
        }],
      });
    } else if (gitInfo.parentPath.startsWith(`${sourceRoot}${path.sep}`)) {
      worktrees.push({
        parentPath: gitInfo.parentPath,
        worktree: {
          name: worktreeDisplayName(entry.name, path.basename(gitInfo.parentPath)),
          path: entryPath,
        },
      });
    }
  }

  for (const { parentPath, worktree } of worktrees) {
    clones.get(parentPath)?.worktrees.push(worktree);
  }

  return [...clones.values()]
    .map((repo) => ({
      ...repo,
      worktrees: repo.worktrees.sort((left, right) => {
        if (left.path === repo.path) {
          return -1;
        }
        if (right.path === repo.path) {
          return 1;
        }
        return left.name.localeCompare(right.name);
      }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

type GitInfo =
  | { kind: 'clone'; branchName: string | null; remoteIdentity?: string }
  | { kind: 'worktree'; parentPath: string };

async function readGitInfo(repoPath: string): Promise<GitInfo | null> {
  const gitPath = path.join(repoPath, '.git');
  try {
    const gitStat = await stat(gitPath);
    if (gitStat.isDirectory()) {
      return {
        kind: 'clone',
        branchName: branchNameFromHead(await readOptionalFile(path.join(gitPath, 'HEAD'))),
        ...remoteIdentityFromConfig(await readOptionalFile(path.join(gitPath, 'config'))),
      };
    }
  } catch {
    return null;
  }

  const gitFile = await readOptionalFile(gitPath);
  const gitDir = gitFile.match(/^gitdir:\s*(.+)\s*$/m)?.[1]?.trim();
  if (!gitDir) {
    return null;
  }

  const worktreesIndex = gitDir.split(path.sep).lastIndexOf('worktrees');
  if (worktreesIndex <= 0) {
    return null;
  }

  return {
    kind: 'worktree',
    parentPath: gitDir.split(path.sep).slice(0, worktreesIndex).join(path.sep).replace(/\/\.git$/, ''),
  };
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function branchNameFromHead(head: string): string | null {
  const trimmed = head.trim();
  if (!trimmed || /^[a-f0-9]{7,}$/i.test(trimmed)) {
    return null;
  }

  return trimmed.replace(/^ref:\s*refs\/heads\//, '') || null;
}

function remoteIdentityFromConfig(config: string): { remoteIdentity?: string } {
  let inOriginSection = false;
  for (const line of config.split(/\r?\n/u)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/u)?.[1];
    if (section) {
      inOriginSection = /^remote\s+"origin"$/iu.test(section);
      continue;
    }
    if (!inOriginSection) continue;
    const url = line.match(/^\s*url\s*=\s*(.+?)\s*$/iu)?.[1];
    if (!url) continue;
    const remoteIdentity = canonicalGitRemoteIdentity(url);
    return remoteIdentity ? { remoteIdentity } : {};
  }
  return {};
}

function worktreeDisplayName(folderName: string, repoName: string): string {
  return folderName.startsWith(`${repoName}-`) ? folderName.slice(repoName.length + 1) : folderName;
}

export function resolveSourceFolderPath(value: string): string {
  const trimmed = value.trim();
  const expanded = trimmed === '~' || trimmed.startsWith('~/')
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed;
  return path.resolve(expanded);
}
