import type { CreateSourceWorktreeInput, SourceBranch, SourceWorktree } from '@workspace/core/contracts';
import { z } from 'zod';

export const repositorySessionSchema = z.object({
  existingBranch: z.string().trim().min(1).max(1024).optional(),
  fetchRemoteBranch: z.boolean().optional(),
  worktree: z.object({
    branchName: z.string().trim().min(1).max(1024),
    baseBranch: z.string().trim().min(1).max(1024).optional(),
    destinationPath: z.string().trim().min(1).optional(),
    requireNewBranch: z.boolean().optional(),
    reuseExisting: z.boolean().optional(),
    fetchRemoteBranch: z.boolean().optional(),
  }).strict().optional(),
}).strict().refine(input => !(input.existingBranch && input.worktree), 'Choose an existing branch or a new worktree.');
export type RepositorySession = z.infer<typeof repositorySessionSchema>;

/** One owner for opening a branch without moving the primary checkout. */
export async function resolveRepositorySession(repositoryRoot: string, selection: RepositorySession, ports: {
  branches(): Promise<SourceBranch[]>;
  createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree>;
}): Promise<string> {
  if (selection.worktree) return (await ports.createWorktree({ repoPath: repositoryRoot, ...selection.worktree })).path;
  const branches = await ports.branches();
  const branch = selection.existingBranch
    ? branches.find(candidate => candidate.name === selection.existingBranch) ?? (selection.fetchRemoteBranch ? { name: selection.existingBranch, isDefault: false, worktreePath: undefined } : undefined)
    : branches.find(candidate => candidate.isDefault);
  if (!branch) throw new Error(selection.existingBranch ? 'Branch not found. Refresh the branch list.' : 'Default branch not found. Refresh the branch list.');
  return branch.worktreePath ?? (await ports.createWorktree({ repoPath: repositoryRoot, branchName: branch.name, reuseExisting: true,
    ...(selection.fetchRemoteBranch === undefined ? {} : { fetchRemoteBranch: selection.fetchRemoteBranch }) })).path;
}
