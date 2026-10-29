import { createHash } from 'node:crypto';
import { lstat, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import type { RepositoryDeletionPreview } from '@workspace/core/contracts/workspace';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import { AgentGitService } from './git/agent-git-service';
import { listSourceWorktrees } from './git-worktrees';
import { backendHomeDir } from './state';

const inside = (folder: string, root: string) => folder === root || folder.startsWith(root + sep);

/** Targets come from an existing local agent and Git, never an arbitrary client path. */
export async function previewRepositoryDeletion(snapshot: AppSnapshot, agent: Agent, git: AgentGitService): Promise<RepositoryDeletionPreview> {
  if (!agent.folder) throw new Error('This agent has no repository.');
  const identity = await git.identity(agent.folder);
  if (identity.kind !== 'git') throw new Error('The repository is no longer available.');
  const repositoryPath = await realpath(identity.primaryWorktreeRoot);
  const gitDirectory = await lstat(join(repositoryPath, '.git'));
  if (!gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()) throw new Error('Select a repository with its own Git directory.');
  const paths = [...new Set(await Promise.all((await listSourceWorktrees(repositoryPath)).map(async worktree => {
    const folder = await realpath(worktree.path);
    if (folder === dirname(folder) || folder === resolve(homedir()) || inside(resolve(backendHomeDir()), folder)) {
      throw new Error('This repository contains a protected application or home folder.');
    }
    const current = await git.identity(folder);
    if (current.kind !== 'git' || await realpath(current.primaryWorktreeRoot) !== repositoryPath) throw new Error('Repository worktrees changed. Reopen the confirmation.');
    return folder;
  })))].sort();
  if (!paths.includes(repositoryPath)) throw new Error('The primary repository checkout is unavailable.');
  if (snapshot.missions?.some(mission => mission.status !== 'completed' && (
    mission.execution?.workspaces?.some(workspace => paths.some(root => inside(resolve(workspace.path), root) || inside(resolve(workspace.repositoryPath), root)))
    || mission.artifacts.tickets.some(ticket => ticket.repositoryPath && paths.some(root => inside(resolve(ticket.repositoryPath!), root)))
  ))) throw new Error('Finish or delete Missions using this repository before deleting it.');
  const agents: RepositoryDeletionPreview['agents'] = [];
  for (const candidate of snapshot.agents) {
    if (!candidate.folder || candidate.remoteConnectionId) continue;
    const folder = await realpath(candidate.folder).catch(() => resolve(candidate.folder!));
    if (paths.some(root => inside(folder, root))) agents.push({ id: candidate.id, name: candidate.name ?? basename(folder) });
  }
  agents.sort((a, b) => a.id.localeCompare(b.id));
  const remote = identity.originUrl && canonicalGitRemoteIdentity(identity.originUrl);
  const confirmationName = remote ? remote.slice(remote.indexOf('/') + 1) : basename(repositoryPath);
  const directories = await Promise.all(paths.map(async folder => {
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Repository folders changed. Reopen the confirmation.');
    return { folder, dev: info.dev, ino: info.ino };
  }));
  const fingerprint = createHash('sha256').update(JSON.stringify({ repositoryPath, confirmationName, directories, agents })).digest('hex');
  return { repositoryPath, confirmationName, paths, agents, fingerprint };
}

export async function removeRepositoryFolders(preview: RepositoryDeletionPreview): Promise<void> {
  // Linked worktrees can live inside the main checkout: remove deepest paths first.
  for (const folder of [...preview.paths].sort((a, b) => b.length - a.length)) await rm(folder, { recursive: true, force: true });
}
