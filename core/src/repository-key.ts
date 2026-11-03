import { canonicalGitRemoteIdentity } from './git-remote';
import type { AgentWorkspaceIdentity } from './contracts/workspace';

export function gitRepositoryKey(remote: string): string | undefined {
  const identity = canonicalGitRemoteIdentity(remote);
  return identity ? `git:${identity}` : undefined;
}

export function fileRepositoryKey(folder: string, host?: string): string {
  const slashPath = folder.replace(/\\/g, '/');
  const normalized = /^[A-Za-z]:\/$/.test(slashPath) ? slashPath : slashPath.replace(/\/$/, '');
  if (!host && normalized.startsWith('//')) return new URL(`file:${normalized.split('/').map(encodeURIComponent).join('/')}`).href;
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const pathname = absolute.split('/').map(encodeURIComponent).join('/').replace(/^\/([A-Za-z])%3A/, '/$1:');
  return new URL(`file://${host ?? ''}${pathname || '/'}`).href;
}

export function workspaceRepositoryKey(workspace: AgentWorkspaceIdentity): string {
  return workspace.repositoryKey ?? (workspace.kind === 'git'
    ? (workspace.originUrl ? gitRepositoryKey(workspace.originUrl) : undefined) ?? fileRepositoryKey(workspace.primaryWorktreeRoot)
    : fileRepositoryKey(workspace.folder));
}

/** Compatibility aliases keep released clients' icon lookups working. */
export function repositoryIconAliases(key: string): string[] {
  if (key.startsWith('git:')) return [key, `remote:${key.slice(4)}`];
  if (key.startsWith('file:')) {
    try {
      const url = new URL(key);
      const local = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
      if (url.host) return [key, `//${url.host}${local}`, `\\\\${url.host}${local.replace(/\//g, '\\')}`];
      return /^[A-Za-z]:\//.test(local) ? [key, local, local.replace(/\//g, '\\')] : [key, local];
    } catch { return [key]; }
  }
  return [key];
}
