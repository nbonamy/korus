import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Agent } from "@workspace/core/contracts";

const run = promisify(execFile);

/** The repository an agent's turns belong to: its main folder, however many worktrees it has. */
export function repositoryIdentityOf(agent: Agent | undefined): string | null {
  if (!agent) return null;
  if (agent.workspace?.kind === "git") return agent.workspace.primaryWorktreeRoot || agent.workspace.repositoryRoot || agent.folder || null;
  return agent.folder ?? null;
}

async function gitRoot(folder: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, timeout: 5000 });
    const common = stdout.trim();
    // A normal repository keeps its data in `<root>/.git`, shared by every worktree.
    return path.basename(common) === ".git" ? path.dirname(common) : null;
  } catch {
    return null;
  }
}

async function exists(folder: string): Promise<boolean> {
  return stat(folder).then(() => true, () => false);
}

async function isRepositoryRoot(folder: string): Promise<boolean> {
  return stat(path.join(folder, ".git")).then(entry => entry.isDirectory(), () => false);
}

/** Worktrees are created beside their repository as `<repository>-<branch>`; use that to place one whose folder is gone. */
async function siblingRepository(folder: string): Promise<string | null> {
  const parent = path.dirname(folder);
  const name = path.basename(folder);
  let siblings: string[];
  try { siblings = await readdir(parent); } catch { return null; }
  const candidates = siblings.filter(sibling => name.startsWith(`${sibling}-`)).sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const root = path.join(parent, candidate);
    if (await isRepositoryRoot(root)) return root;
  }
  return null;
}

/**
 * Best guess at each folder's repository, for turns saved before the repository itself was recorded.
 * Folders it cannot place are left out, so the ledger keeps what it had.
 */
export async function resolveRepositoryRoots(folders: readonly string[], agents: readonly Agent[]): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  for (const agent of agents) {
    if (agent.folder && agent.workspace?.kind === "git") known.set(agent.folder, agent.workspace.primaryWorktreeRoot || agent.workspace.repositoryRoot);
  }
  const resolved = new Map<string, string>();
  for (const folder of folders) {
    const root = known.get(folder)
      ?? (await exists(folder) ? await gitRoot(folder) : await siblingRepository(folder));
    if (root) resolved.set(folder, root);
  }
  return resolved;
}
