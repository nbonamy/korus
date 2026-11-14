const REMOTE_KEY_PREFIX = 'remote:';

/** Only a same-named tracked branch belongs to this branch's deletion choice. */
export function matchingBranchUpstream(branch: string | null | undefined, upstream: string | null | undefined, baseBranch?: string | null): string | undefined {
  if (!branch || branch === baseBranch || !upstream) return undefined;
  const separator = upstream.indexOf('/');
  return separator > 0 && upstream.slice(separator + 1) === branch ? upstream : undefined;
}

export function sanitizeGitRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const scpLike = trimmed.match(/^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/u);
  if (scpLike && !trimmed.includes('://')) {
    const path = scpLike[2].trim().replace(/[?#].*$/u, '').replace(/^\/+|\/+$/gu, '');
    return path ? `${scpLike[1]}:${path}` : undefined;
  }

  try {
    const url = new URL(trimmed);
    if (!url.hostname) return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * A URL that can be cloned from a persisted remote. Persistence strips the user of SSH addresses, but Git
 * hosts expect the conventional `git` user, so `github.com:org/repo.git` cannot be cloned as stored.
 */
export function cloneUrlForRemote(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || !canonicalGitRemoteIdentity(trimmed)) return undefined;
  if (/^[^/:\s]+@[^/:\s]+:/u.test(trimmed) && !trimmed.includes('://')) return trimmed;
  if (!trimmed.includes('://')) return `git@${trimmed}`;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'ssh:' && !url.username) url.username = 'git';
    return url.toString();
  } catch {
    return undefined;
  }
}

/** The page a remote's repository lives at on its host, from any clone URL: `git@host:org/repo.git`, `ssh://git@host:22/org/repo` or `https://host/org/repo.git`. */
export function repositoryWebUrl(value: string): string | undefined {
  const safeRemote = sanitizeGitRemoteUrl(value);
  if (!safeRemote || /^[A-Za-z]:[\\/]/.test(value.trim())) return undefined;
  const scpLike = safeRemote.match(/^([^/:\s]+):(.+)$/u);
  if (scpLike && !safeRemote.includes('://')) return webUrl(scpLike[1], scpLike[2]);
  try {
    const url = new URL(safeRemote);
    // An SSH or git port is not a web port.
    return webUrl(url.protocol === 'http:' || url.protocol === 'https:' ? url.host : url.hostname, url.pathname);
  } catch {
    return undefined;
  }
}

function webUrl(host: string, path: string): string | undefined {
  const cleanHost = host.trim().toLocaleLowerCase();
  const cleanPath = cleanRemotePath(path);
  return cleanHost && cleanPath ? `https://${cleanHost}/${cleanPath}` : undefined;
}

export function canonicalGitRemoteIdentity(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) return undefined;

  if (trimmed.startsWith(REMOTE_KEY_PREFIX) || trimmed.startsWith('git:')) {
    const identity = trimmed.slice(trimmed.startsWith('git:') ? 4 : REMOTE_KEY_PREFIX.length).trim();
    return isCanonicalIdentity(identity) ? identity : undefined;
  }

  const safeRemote = sanitizeGitRemoteUrl(trimmed);
  if (!safeRemote) return undefined;

  const scpLike = safeRemote.match(/^([^/:\s]+):(.+)$/u);
  if (scpLike && !safeRemote.includes('://')) {
    return remoteIdentity(scpLike[1], scpLike[2]);
  }

  try {
    const url = new URL(safeRemote);
    return remoteIdentity(url.host, url.pathname);
  } catch {
    return undefined;
  }
}

export function repositoryIconKeyForRemote(value: string): string | undefined {
  const identity = canonicalGitRemoteIdentity(value);
  return identity ? `${REMOTE_KEY_PREFIX}${identity}` : undefined;
}

function remoteIdentity(host: string, path: string): string | undefined {
  const cleanHost = host.trim().toLocaleLowerCase();
  const cleanPath = cleanRemotePath(path);
  return cleanHost && cleanPath ? `${cleanHost}/${cleanPath}` : undefined;
}

function cleanRemotePath(value: string): string {
  return value
    .trim()
    .replace(/[?#].*$/u, '')
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.git$/iu, '');
}

function isCanonicalIdentity(value: string): boolean {
  return /^[^/:\s]+(?::\d+)?\/[^\s]+$/u.test(value) && !value.includes('@');
}
