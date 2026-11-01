import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { GitPruneInput, GitPruneInventory, GitPruneResult, GitPruneTarget } from '@workspace/core/contracts/git-prune';
import type { AgentGitRunner } from './agent-git-service';

type Owner = { folder: string; name: string };
type Worktree = { path: string; branch?: string; locked: boolean; prunable: boolean };
type Candidate = GitPruneTarget & { remoteUrl?: string };

// Ignored directories stay collapsed (`!! node_modules/`); expanding them overflows the Git output buffer.
const WORKTREE_STATUS_ARGS = ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'];

/** Inventory and deletion share one safety policy; the client never supplies a path or Git command. */
export class GitPruneService {
  private readonly running = new Set<string>();

  constructor(private readonly git: AgentGitRunner) {}

  async inventory(folder: string, owners: Owner[]): Promise<GitPruneInventory> {
    const { inventory } = await this.inspect(await this.repositoryFolder(folder), owners);
    return inventory;
  }

  async prune(folder: string, input: GitPruneInput, owners: () => Owner[]): Promise<GitPruneResult> {
    if (input?.confirmed !== true || !Array.isArray(input.targets) || !input.targets.length
      || input.targets.some(target => !target || typeof target.id !== 'string' || typeof target.revision !== 'string')
      || new Set(input.targets.map(target => target.id)).size !== input.targets.length) {
      throw new Error('Select items and confirm pruning.');
    }
    folder = await this.repositoryFolder(folder);
    const commonDir = await this.git(folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const key = await realpath(commonDir.stdout.trim());
    if (this.running.has(key)) throw new Error('Repository pruning is already running.');
    this.running.add(key);
    const result: GitPruneResult = { deleted: [], failed: [] };
    try {
      const initial = await this.inspect(folder, owners());
      for (const selected of input.targets) {
        const current = initial.candidates.find(target => target.id === selected.id);
        if (!current || current.blocked === 'unavailable' || ((!current.merged || current.blocked) && input.force !== true) || current.revision !== selected.revision) {
          result.failed.push({ id: selected.id, message: 'This item changed or is no longer safe to prune. Refresh the list.' });
        }
      }
      // A stale/unsafe selection prevents the whole batch from starting.
      if (result.failed.length) return result;
      for (const selected of input.targets) {
        let worktreeRemoved = false;
        const target = initial.candidates.find(item => item.id === selected.id)!;
        try {
          const baseSha = (await this.git(folder, ['rev-parse', '--verify', `refs/heads/${initial.inventory.baseBranch}`])).stdout.trim();
          if (target.kind === 'local') {
            const sha = (await this.git(folder, ['rev-parse', '--verify', target.id])).stdout.trim();
            const trees = parseWorktrees((await this.git(folder, ['worktree', 'list', '--porcelain', '-z'])).stdout);
            const matches = trees.filter(tree => tree.branch === target.branch);
            if (target.worktree ? matches.length !== 1 || matches[0]?.path !== target.worktree : matches.length !== 0) throw new Error('Worktree changed.');
            if (matches[0] && await missingWorktree(matches[0]) !== Boolean(target.worktreeMissing)) throw new Error('Worktree changed.');
            const state = await this.worktreeState(matches[0], Boolean(target.worktreeMissing), owners());
            if (revision([target.id, sha, baseSha, target.worktree ?? '', target.worktreeMissing ? 'missing' : 'present', state]) !== target.revision) throw new Error('Branch or worktree changed.');
          } else {
            const remote = target.name.slice(0, -(target.branch.length + 1));
            const url = (await this.git(folder, ['remote', 'get-url', '--push', '--all', remote])).stdout.trim();
            if (revision([target.id, target.sha, baseSha, url]) !== target.revision) throw new Error('Remote changed.');
          }
          if (target.kind === 'remote') {
            // Lease pins the actual destination head, not a potentially stale tracking ref.
            await this.git(folder, ['push', `--force-with-lease=refs/heads/${target.branch}:${target.sha}`, '--', target.remoteUrl!, `:refs/heads/${target.branch}`]);
          } else {
            if (target.worktree) {
              const path = await canonical(target.worktree);
              if (input.force !== true && owners().some(owner => contains(path, owner.folder))) throw new Error('Worktree is in use.');
              if (target.worktreeMissing) {
                if (!await missingPath(target.worktree)) throw new Error('Worktree was restored.');
              } else {
                const status = await this.git(path, WORKTREE_STATUS_ARGS);
                if (status.stdout && input.force !== true) throw new Error('Worktree has files.');
              }
              await this.git(folder, ['worktree', 'remove', ...(input.force === true ? ['--force', '--force'] : []), '--', target.worktree]);
              worktreeRemoved = true;
            }
            // Ancestry against our displayed base was validated above. Git -d instead
            // checks the tracking branch, which may lag behind that base.
            await this.git(folder, ['branch', '-D', '--', target.branch]);
          }
          result.deleted.push(target.id);
        } catch (cause) {
          const detail = pruneFailureDetail(cause, target.remoteUrl);
          result.failed.push({ id: selected.id, message: `${target.name}: ${worktreeRemoved
            ? 'Worktree removed, but the local branch was retained. '
            : ''}${detail || 'Could not finish pruning this item.'} Refresh the list before retrying.` });
          break;
        }
      }
      return result;
    } finally {
      this.running.delete(key);
    }
  }

  private async repositoryFolder(folder: string): Promise<string> {
    const trees = parseWorktrees((await this.git(folder, ['worktree', 'list', '--porcelain', '-z'])).stdout);
    if (!trees[0]) throw new Error('Repository worktree is unavailable.');
    return trees[0].path;
  }

  private async worktreeState(tree: Worktree | undefined, missing: boolean, owners: Owner[], status?: string): Promise<string> {
    if (!tree) return '';
    const path = await canonical(tree.path);
    const usedBy = (await Promise.all(owners.map(async owner => ({ ...owner, folder: await canonical(owner.folder) }))))
      .filter(owner => contains(path, owner.folder)).map(owner => `${owner.folder}:${owner.name}`).sort();
    const files = missing ? '' : status ?? (await this.git(tree.path, WORKTREE_STATUS_ARGS)).stdout;
    return revision([String(tree.locked), files, ...usedBy]);
  }

  private async inspect(folder: string, owners: Owner[]): Promise<{ inventory: GitPruneInventory; candidates: Candidate[] }> {
    const [root, refs, trees, remotesOutput, defaultOutput] = await Promise.all([
      this.git(folder, ['rev-parse', '--show-toplevel']),
      this.git(folder, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/']),
      this.git(folder, ['worktree', 'list', '--porcelain', '-z']),
      this.git(folder, ['remote']),
      this.git(folder, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => ({ stdout: '' })),
    ]);
    const localRefs = refs.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [ref, sha] = line.split('\0');
      return { branch: ref!.slice('refs/heads/'.length), sha: sha! };
    });
    const defaultBranch = defaultOutput.stdout.trim().replace(/^[^/]+\//u, '');
    const baseBranch = [defaultBranch, 'main', 'master'].find(name => name && localRefs.some(ref => ref.branch === name));
    if (!baseBranch) throw new Error('No local default branch is available to check merged branches.');
    const baseSha = localRefs.find(ref => ref.branch === baseBranch)!.sha;
    const hidden = new Set([baseBranch, defaultBranch]);
    const worktrees = parseWorktrees(trees.stdout);
    const rootPath = await canonical(root.stdout.trim());
    if (worktrees[0]?.branch) hidden.add(worktrees[0].branch);
    const canonicalOwners = await Promise.all(owners.map(async owner => ({ ...owner, folder: await canonical(owner.folder) })));
    const candidates: Candidate[] = [];
    const classify = async (sha: string): Promise<{ merged: boolean; commitsAhead?: number }> => {
      try {
        const count = Number((await this.git(folder, ['rev-list', '--count', `${baseSha}..${sha}`, '--'])).stdout.trim());
        return { merged: count === 0, commitsAhead: count };
      } catch { return { merged: false }; }
    };
    for (const { branch, sha } of localRefs) {
      if (hidden.has(branch)) continue;
      const matches = worktrees.filter(tree => tree.branch === branch);
      const tree = matches[0];
      // The primary worktree is never removed, even when checked out on a topic branch.
      if (tree && (tree === worktrees[0] || await canonical(tree.path) === rootPath)) continue;
      const merge = await classify(sha);
      const treePath = tree ? await canonical(tree.path) : undefined;
      const worktreeMissing = tree ? await missingWorktree(tree) : false;
      const usedBy = treePath ? canonicalOwners.filter(owner => contains(treePath, owner.folder)).map(owner => owner.name) : [];
      let changedFiles = 0;
      let uncommittedFiles = 0;
      let statusText = '';
      let blocked: GitPruneTarget['blocked'] = !merge.merged ? 'notMerged' : undefined;
      if (tree) {
        try {
          // Include ignored files in the explicit discard warning.
          if (!worktreeMissing) {
            const status = await this.git(tree.path, WORKTREE_STATUS_ARGS);
            statusText = status.stdout;
            ({ changedFiles, uncommittedFiles } = worktreeFileCounts(status.stdout));
            if (status.stdout) blocked = 'changes';
          }
        } catch { blocked = 'unavailable'; }
        if (tree.locked || matches.length > 1) blocked = 'locked';
        if (usedBy.length) blocked = 'inUse';
        if (matches.length > 1) blocked = 'unavailable';
      }
      const id = `refs/heads/${branch}`;
      candidates.push({ id, kind: 'local', name: branch, branch, sha, ...merge, usedBy, changedFiles, uncommittedFiles,
        ...(tree ? { worktree: tree.path, worktreeLabel: relative(rootPath, tree.path) } : {}), ...(blocked ? { blocked } : {}),
        ...(worktreeMissing ? { worktreeMissing: true } : {}),
        revision: revision([id, sha, baseSha, tree?.path ?? '', worktreeMissing ? 'missing' : 'present', await this.worktreeState(tree, worktreeMissing, owners, statusText)]),
      });
    }
    const unavailableRemotes: string[] = [];
    for (const remote of remotesOutput.stdout.trim().split('\n').filter(Boolean)) {
      try {
        const urls = (await this.git(folder, ['remote', 'get-url', '--push', '--all', remote])).stdout.trim().split('\n');
        if (urls.length !== 1) throw new Error('Ambiguous push destination');
        const remoteUrl = urls[0]!;
        const heads = await this.git(folder, ['ls-remote', '--symref', '--', remoteUrl, 'HEAD', 'refs/heads/*']);
        const remoteDefault = heads.stdout.match(/^ref: refs\/heads\/(.+)\tHEAD$/mu)?.[1];
        for (const line of heads.stdout.split('\n')) {
          const match = /^([a-f0-9]{40,64})\trefs\/heads\/(.+)$/u.exec(line);
          if (!match) continue;
          const sha = match[1]!;
          const branch = match[2]!;
          if (hidden.has(branch) || branch === remoteDefault) continue;
          const merge = await classify(sha);
          const id = `refs/remotes/${remote}/${branch}`;
          candidates.push({ id, kind: 'remote', name: `${remote}/${branch}`, branch, sha, ...merge,
            usedBy: [], changedFiles: 0,
            revision: revision([id, sha, baseSha, remoteUrl]), remoteUrl,
          });
        }
      } catch { unavailableRemotes.push(remote); }
    }
    const groups = new Map<string, GitPruneInventory['groups'][number]>();
    for (const candidate of candidates) {
      const { remoteUrl: _url, ...target } = candidate;
      const group = groups.get(target.branch) ?? { branch: target.branch, remotes: [] };
      if (target.kind === 'local') group.local = target;
      else group.remotes.push(target);
      groups.set(target.branch, group);
    }
    return { candidates, inventory: { repository: basename(worktrees[0]?.path ?? rootPath), baseBranch,
      groups: [...groups.values()].sort((a, b) => groupRank(a) - groupRank(b) || a.branch.localeCompare(b.branch)), unavailableRemotes,
    } };
  }
}

function worktreeFileCounts(status: string): { changedFiles: number; uncommittedFiles: number } {
  const entries = status.split('\0');
  let changedFiles = 0;
  let uncommittedFiles = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (!entry) continue;
    const flags = entry.slice(0, 2);
    // Renames/copies have a second NUL-delimited path, not a second changed file.
    if (/[RC]/u.test(flags)) index += 1;
    if (flags === '!!' || entry.slice(3).split('/').includes('node_modules')) continue;
    changedFiles += 1;
    uncommittedFiles += 1;
  }
  return { changedFiles, uncommittedFiles };
}

function pruneFailureDetail(cause: unknown, remoteUrl?: string): string {
  if (!cause || typeof cause !== 'object') return '';
  const error = cause as { stderr?: unknown; message?: unknown; cmd?: unknown };
  // Child-process messages include the complete command, potentially with credentials.
  const detail = typeof error.stderr === 'string' ? error.stderr : !error.cmd && typeof error.message === 'string' ? error.message : '';
  return (remoteUrl ? detail.split(remoteUrl).join('[remote]') : detail)
    .replace(/(?:https?|ssh):\/\/[^\s]+/gu, '[remote]')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 1000);
}

function revision(parts: string[]): string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
function groupRank(group: GitPruneInventory['groups'][number]): number {
  if (!group.local) return 4;
  return (group.local.blocked ? 2 : 0) + (group.local.worktree ? 0 : 1);
}
function parseWorktrees(output: string): Worktree[] {
  return output.split('\0\0').filter(Boolean).map(entry => {
    const fields = entry.split('\0');
    return {
      path: fields.find(field => field.startsWith('worktree '))!.slice(9),
      branch: fields.find(field => field.startsWith('branch refs/heads/'))?.slice(18),
      locked: fields.some(field => field === 'locked' || field.startsWith('locked ')),
      prunable: fields.some(field => field === 'prunable' || field.startsWith('prunable ')),
    };
  });
}
async function missingWorktree(tree: Worktree): Promise<boolean> {
  if (!tree.prunable && !tree.locked) return false;
  return missingPath(tree.path);
}
async function missingPath(path: string): Promise<boolean> {
  try { await lstat(path); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}
async function canonical(folder: string): Promise<string> { return realpath(folder).catch(() => resolve(folder)); }
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
