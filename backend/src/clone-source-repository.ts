import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import { AppError } from '@workspace/core/app-error';
import type { SourceRepository } from '@workspace/core/contracts';
import { resolveSourceFolderPath, scanSourceRepositories } from './source-repositories';

const execFileAsync = promisify(execFile);

type CommandRunner = {
  run: (command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) => Promise<{ stdout?: string }>;
};

const defaultRunner: CommandRunner = {
  run: (command, args, options) => execFileAsync(command, args, {
    cwd: options.cwd,
    ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
  }),
};

// Providers whose SSH address mirrors their web address.
const sshFirstHosts = new Set(['github.com', 'gitlab.com']);
const authenticationFailure = /could not read (?:username|password)|terminal prompts disabled|permission denied|authentication failed|host key verification failed|could not read from remote repository|access denied|invalid credentials/iu;

/** Never prompt: a daemon has no terminal, so a prompt would hang the clone. New hosts are trusted on first use. */
function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  const ssh = [process.env.GIT_SSH_COMMAND?.trim() || 'ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15'].join(' ');
  return { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: ssh };
}

/** Returns the SSH address of a plain HTTPS repository URL on a known provider host, if there is one. */
function sshAddress(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !sshFirstHosts.has(parsed.hostname.toLowerCase())) return null;
    const repositoryPath = parsed.pathname.replace(/^\/+|\/+$/gu, '').replace(/\.git$/iu, '');
    return repositoryPath.includes('/') ? `git@${parsed.hostname.toLowerCase()}:${repositoryPath}.git` : null;
  } catch {
    return null;
  }
}

function remoteHost(url: string): string {
  const scp = /^(?:[^@/:\s]+@)?([^/:\s]+):(?!\/\/)/u.exec(url);
  if (scp && !url.includes('://')) return scp[1]!;
  try { return new URL(url).hostname; } catch { return url; }
}

function gitFailureDetail(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).slice(-2).join(' ').slice(0, 300);
}

async function cloneWithFallback(runner: CommandRunner, url: string, destinationPath: string, sourceRoot: string, repositoryName: string): Promise<void> {
  const ssh = sshAddress(url);
  const attempts = ssh ? [ssh, url] : [url];
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await runner.run('git', ['clone', '--', attempt, destinationPath], { cwd: sourceRoot, env: nonInteractiveGitEnv() });
      return;
    } catch (error) {
      lastError = error;
      // A failed clone can leave a partial folder behind; the next attempt needs the path free.
      await rm(destinationPath, { recursive: true, force: true });
    }
  }
  const detail = gitFailureDetail(lastError);
  const host = remoteHost(url);
  if (authenticationFailure.test(detail)) {
    throw new AppError('clone.authenticationFailed', `Could not access ${repositoryName} on ${host}. ${detail}`, { repository: repositoryName, host });
  }
  throw new AppError('clone.failed', `Could not clone ${repositoryName}: ${detail}`, { repository: repositoryName, detail });
}

export async function cloneSourceRepository(
  sourceFolderPath: string,
  repositoryUrl: string,
  runner: CommandRunner = defaultRunner,
): Promise<SourceRepository> {
  const configuredSourceRoot = sourceFolderPath.trim();
  const url = repositoryUrl.trim();
  if (!configuredSourceRoot) throw new AppError('clone.sourceFolderMissing', 'Source folder is not configured.');
  if (!url) throw new AppError('clone.urlRequired', 'Repository URL is required.');

  const sourceRoot = resolveSourceFolderPath(configuredSourceRoot);
  const repositoryName = repositoryNameFromUrl(url);
  const destinationPath = path.join(sourceRoot, repositoryName);
  await mkdir(sourceRoot, { recursive: true });

  if (await pathExists(destinationPath)) {
    const existingRemote = (await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: destinationPath })
      .catch(() => ({ stdout: '' }))).stdout?.trim();
    if (!existingRemote || (canonicalGitRemoteIdentity(existingRemote) ?? normalizeGitUrl(existingRemote)) !== (canonicalGitRemoteIdentity(url) ?? normalizeGitUrl(url))) {
      throw new AppError('clone.alreadyExists', `${repositoryName} already exists in the source folder.`, { repository: repositoryName });
    }
  } else {
    await cloneWithFallback(runner, url, destinationPath, sourceRoot, repositoryName);
  }

  const repositories = await scanSourceRepositories(sourceRoot);
  const repository = repositories.find((candidate) => candidate.path === destinationPath);
  if (!repository) {
    throw new AppError(
      'clone.discoveryFailed',
      `Cloned ${repositoryName}, but could not discover it in the source folder.`,
      { repository: repositoryName },
    );
  }
  return repository;
}

export function repositoryNameFromUrl(repositoryUrl: string): string {
  const normalized = repositoryUrl.trim().replace(/[?#].*$/u, '').replace(/\/+$/u, '');
  const repositoryPath = /^[^/:]+@[^:]+:/u.test(normalized)
    ? normalized.slice(normalized.lastIndexOf(':') + 1)
    : normalized;
  const pathPart = repositoryPath.slice(repositoryPath.lastIndexOf('/') + 1);
  const name = pathPart.replace(/\.git$/iu, '').trim();
  if (!name || name === '.' || name === '..' || /[/\\]/u.test(name)) {
    throw new AppError('clone.invalidName', 'Repository URL does not contain a valid repository name.');
  }
  return name;
}

function normalizeGitUrl(value: string): string {
  return value.trim().replace(/\.git$/iu, '').replace(/\/+$/u, '').toLocaleLowerCase();
}

async function pathExists(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}
