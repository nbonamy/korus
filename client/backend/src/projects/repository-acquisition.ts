import type { SourceRepository } from '@workspace/core/contracts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';

/** Shared acquisition policy; a caller may revalidate access immediately before the write. */
export async function acquireRepository(url: string, reuseExisting: boolean, ports: {
  repositories(): Promise<SourceRepository[]>;
  clone(): Promise<SourceRepository>;
}): Promise<SourceRepository> {
  if (reuseExisting) {
    const identity = canonicalGitRemoteIdentity(url);
    const repositories = await ports.repositories();
    const existing = identity && repositories.find(repository => repository.remoteIdentity === identity);
    if (existing) return existing;
  }
  return ports.clone();
}
