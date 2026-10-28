import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@workspace/core/contracts";
import { missionsRepositoryKey } from "@workspace/core/usage";
import { repositoryIdentityOf, resolveRepositoryRoots } from "../repository-identity";
import { UsageLedger } from "../usage-ledger";
import { UsageService } from "../usage-service";

const run = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
const agent = (over: Partial<Agent>): Agent => ({ id: "a", name: null, teamId: "t", folder: null, ...over }) as Agent;
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });

describe("repositoryIdentityOf", () => {
  it("names a repository by its main folder, whichever worktree the agent works in", () => {
    const workspace = { kind: "git", folder: "/src/korus-feature", repositoryName: "korus", repositoryRoot: "/src/korus-feature", branch: "feature", isLinkedWorktree: true, primaryWorktreeRoot: "/src/korus", updatedAt: "" } as const;
    expect(repositoryIdentityOf(agent({ folder: "/src/korus-feature", workspace }))).toBe("/src/korus");
    expect(repositoryIdentityOf(agent({ folder: "/notes", workspace: { kind: "folder", folder: "/notes", label: "notes", updatedAt: "" } }))).toBe("/notes");
    expect(repositoryIdentityOf(agent({ folder: "/loose" }))).toBe("/loose");
    expect(repositoryIdentityOf(agent({ folder: null }))).toBeNull();
    // A mission's lead works in the mission's own home, which belongs to no repository.
    expect(repositoryIdentityOf(agent({ folder: "/Users/me/.korus/missions/mission-b990325c-7ee9-4f05-99ff-0123456789ab" }))).toBe(missionsRepositoryKey);
    expect(repositoryIdentityOf(undefined)).toBeNull();
  });
});

describe("resolveRepositoryRoots", () => {
  it("maps worktree folders to their repository, including worktrees that no longer exist", async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), "usage-repos-")));
    temporary.push(base);
    const repo = path.join(base, "korus");
    await mkdir(repo);
    await git(repo, "init", "-q");
    await git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    await git(repo, "worktree", "add", "-q", "-b", "feature", path.join(base, "korus-feature"));
    const gone = path.join(base, "korus-old-branch");
    const stranger = path.join(base, "unrelated-thing");
    const map = await resolveRepositoryRoots([repo, path.join(base, "korus-feature"), gone, stranger, "/nowhere/else"], []);
    expect(Object.fromEntries(map)).toStrictEqual({
      [repo]: repo,
      [path.join(base, "korus-feature")]: repo,
      [gone]: repo,
    });
  });

  it("files mission homes under Missions, whether or not they still exist", async () => {
    const home = "/Users/me/.korus/missions/mission-a236a29c-79b0-4786-a4a3-9d2109d6010f";
    const map = await resolveRepositoryRoots([home, "C:\\korus\\missions\\mission-1"], []);
    expect(Object.fromEntries(map)).toStrictEqual({ [home]: missionsRepositoryKey, "C:\\korus\\missions\\mission-1": missionsRepositoryKey });
  });

  it("trusts what an agent already knows about its workspace before touching the disk", async () => {
    const workspace = { kind: "git", folder: "/vanished/app-fix", repositoryName: "app", repositoryRoot: "/vanished/app-fix", branch: "fix", isLinkedWorktree: true, primaryWorktreeRoot: "/vanished/app", updatedAt: "" } as const;
    const map = await resolveRepositoryRoots(["/vanished/app-fix"], [agent({ folder: "/vanished/app-fix", workspace })]);
    expect(Object.fromEntries(map)).toStrictEqual({ "/vanished/app-fix": "/vanished/app" });
  });
});

describe("recording and migrating the repository", () => {
  const observation = (agentId: string, turnId: string) => ({ provider: "codex" as const, model: "m", agentId, sessionId: "s", turnId, at: Date.now(), tokens: { input: 10, output: 1, cacheRead: 0, cacheWrite: null } });
  const labels = (local: UsageLedger) => local.query({ group: "repository" }).rows.map(row => row.label).sort();

  it("records new turns against the repository, not the worktree folder", async () => {
    const local = new UsageLedger(":memory:");
    const workspace = { kind: "git", folder: "/src/korus-feature", repositoryName: "korus", repositoryRoot: "/src/korus-feature", branch: "f", isLinkedWorktree: true, primaryWorktreeRoot: "/src/korus", updatedAt: "" } as const;
    const usage = new UsageService(local, () => agent({ folder: "/src/korus-feature", workspace }));
    await local.load();
    usage.observe({ ...observation("a", "t1"), phase: "started" });
    await usage.drain();
    expect(labels(local)).toStrictEqual(["/src/korus"]);
    await usage.close();
  });

  it("rewrites folders recorded before this change once, and leaves unknown folders alone", async () => {
    const local = new UsageLedger(":memory:");
    const usage = new UsageService(local, () => agent({ folder: "/src/korus-feature" }));
    await local.load();
    for (const [id, folder] of [["1", "/src/korus-feature"], ["2", "/src/korus-other"], ["3", "/elsewhere"]] as const) {
      await local.observe({ ...observation("a", id), phase: "started" }, { teamId: "t", repository: folder });
    }
    const resolve = vi.fn(async () => new Map([["/src/korus-feature", "/src/korus"], ["/src/korus-other", "/src/korus"]]));
    await usage.migrateRepositories(resolve);
    expect(labels(local)).toStrictEqual(["/elsewhere", "/src/korus"]);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining(["/src/korus-feature", "/src/korus-other", "/elsewhere"]));
    await usage.migrateRepositories(resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    await usage.close();
  });

  it("runs again when an earlier version of the migration already ran, and leaves repositories it filed before alone", async () => {
    const local = new UsageLedger(":memory:");
    const usage = new UsageService(local, () => undefined);
    await local.load();
    await local.observe({ ...observation("a", "1"), phase: "started" }, { teamId: "t", repository: "/src/korus" });
    await local.observe({ ...observation("a", "2"), phase: "started" }, { teamId: "t", repository: "/home/.korus/missions/mission-1" });
    (local as unknown as { open(): { prepare(sql: string): { run(): void } } }).open().prepare("INSERT OR REPLACE INTO metadata VALUES('repository_identity','1')").run();
    await usage.migrateRepositories(async (folders) => new Map(folders.map((folder) => [folder, folder.includes("missions") ? "korus:missions" : folder])));
    expect(labels(local)).toStrictEqual(["/src/korus", "korus:missions"]);
  });

  it("tries again next start when the guess could not be made", async () => {
    const local = new UsageLedger(":memory:");
    const usage = new UsageService(local, () => undefined);
    await local.load();
    await local.observe({ ...observation("a", "1"), phase: "started" }, { teamId: "t", repository: "/src/korus-feature" });
    await usage.migrateRepositories(async () => { throw new Error("git unavailable"); });
    expect(labels(local)).toStrictEqual(["/src/korus-feature"]);
    const resolve = vi.fn(async () => new Map([["/src/korus-feature", "/src/korus"]]));
    await usage.migrateRepositories(resolve);
    expect(labels(local)).toStrictEqual(["/src/korus"]);
    await usage.close();
  });
});
