import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Agent } from '@workspace/core/contracts';
import type { BranchWorkInput, BranchWorkPreview, BranchWorkResult } from '@workspace/core/branch-current-work';
import { suggestedSourceWorktreePath } from '../git-worktrees';
import { WorktreeManager } from '../worktrees/worktree-manager';
import { AgentGitService } from './agent-git-service';

const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Capture = BranchWorkPreview & { fingerprints: Record<string, string> };
type Journal = {
  specification: string; source: string; head: string; tree: string;
  fingerprints: Record<string, string>; cleaned: string[];
  result: BranchWorkResult;
};
type Options = {
  git: AgentGitService;
  provision(agent: Agent, input: BranchWorkInput, folder: string): Promise<{ taskId: string; agentId: string; accepted: boolean }>;
};

/** Recoverable local transfer. Only selected paths are restored; source HEAD never moves. */
export class BranchCurrentWorkService {
  private readonly active = new Map<string, Promise<BranchWorkResult>>();
  constructor(private readonly options: Options) {}

  async preview(folder: string): Promise<BranchWorkPreview> {
    const { fingerprints: _fingerprints, ...preview } = await this.capture(folder);
    return preview;
  }

  execute(agent: Agent, input: BranchWorkInput): Promise<BranchWorkResult> {
    const key = JSON.stringify([agent.id, input.requestId]);
    // Serialize all transfers for a source checkout, including different request IDs.
    const source = agent.folder ?? '';
    const previous = this.active.get(source);
    const operation = (previous ?? Promise.resolve()).catch(() => undefined).then(() => this.transfer(agent, input, key));
    this.active.set(source, operation);
    void operation.finally(() => { if (this.active.get(source) === operation) this.active.delete(source); }).catch(() => undefined);
    return operation;
  }

  private async transfer(agent: Agent, input: BranchWorkInput, key: string): Promise<BranchWorkResult> {
    if (input.confirmed !== true || !input.requestId?.trim() || input.requestId.length > 200 || !input.message?.trim() || !input.prompt?.trim()) throw new Error('Confirm a branch name, commit message and task before transferring.');
    if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some(value => typeof value !== 'string') || new Set(input.paths).size !== input.paths.length) throw new Error('Select distinct changed paths.');
    if (!agent.folder) throw new Error('Choose a repository first.');
    const source = await this.root(agent.folder);
    const common = await git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const journalPath = path.join(common, 'korus', 'branch-transfers', `${hash(key)}.json`);
    const specification = hash(JSON.stringify(input));
    let journal = await readJournal(journalPath);
    if (journal && journal.specification !== specification) throw new Error('This requestId belongs to a different transfer.');
    if (journal && journal.source !== source) throw new Error('The source checkout changed. Recover from the original checkout.');
    if (journal?.result.state === 'completed') return journal.result;
    if (!journal) {
      const captured = await this.capture(source);
      if (input.snapshotId !== captured.snapshotId) throw new Error('The checkout changed. Refresh the file selection before branching.');
      if (!input.branchName?.trim() || input.branchName !== input.branchName.trim() || input.branchName.startsWith('-')) throw new Error('Enter a valid branch name.');
      await git(source, ['check-ref-format', '--branch', input.branchName]);
      const refs = await git(source, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
      if (refs.split('\n').some(ref => ref === `refs/heads/${input.branchName}` || ref.endsWith(`/${input.branchName}`))) throw new Error('That branch already exists.');
      const folder = suggestedSourceWorktreePath(source, input.branchName);
      if (await exists(folder)) throw new Error('The destination folder already exists. Choose another branch name.');
      for (const selected of input.paths) {
        await this.safePath(source, selected);
        if (!captured.files.some(file => file.path === selected)) throw new Error(`Path is not a transferable change: ${selected}`);
      }
      const index = path.join(common, `korus-branch-index-${randomUUID()}`);
      let tree: string;
      try {
        await git(source, ['read-tree', captured.head], index);
        await git(source, ['add', '-A', '--', ...input.paths], index);
        tree = await git(source, ['write-tree'], index);
        const changed = (await git(source, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', captured.head, tree])).split('\0').filter(Boolean);
        if (input.paths.some(selected => !changed.includes(selected))) throw new Error('A selected path has no final changes relative to HEAD. Deselect it; its staging state will be preserved.');
        if ((await this.capture(source)).snapshotId !== captured.snapshotId) throw new Error('The checkout changed while capturing. Refresh the selection.');
      } finally { await rm(index, { force: true }); }
      journal = { specification, source, head: captured.head, tree, fingerprints: Object.fromEntries(input.paths.map(selected => [selected, captured.fingerprints[selected]!])), cleaned: [], result: { state: 'recovery', branchName: input.branchName, folder, retainedPaths: [...input.paths] } };
      await saveJournal(journalPath, journal);
    }
    const record = journal;
    try {
      const folder = record.result.folder;
      if (!await exists(folder)) {
        // No setup scripts or automatic environment copying in a transfer.
        await new WorktreeManager().create({ repoPath: source, branchName: input.branchName, destinationPath: folder, startPoint: record.head, requireNewBranch: true }, { skipInitialization: true });
      }
      if (await this.root(folder) !== await realpath(folder) || await git(folder, ['symbolic-ref', '--short', 'HEAD']) !== input.branchName) throw new Error('The recovery destination is no longer the expected worktree.');
      if (!record.result.commit) {
        const head = await git(folder, ['rev-parse', 'HEAD']);
        // A successful commit may precede the journal write. Recover it without a second commit.
        if (head !== record.head) {
          if (await git(folder, ['rev-parse', 'HEAD^']) !== record.head || await git(folder, ['rev-parse', 'HEAD^{tree}']) !== record.tree) throw new Error('Destination HEAD changed. Inspect the retained worktree.');
        } else {
          const tree = await git(folder, ['write-tree']);
          const dirty = await git(folder, ['status', '--porcelain']);
          if (dirty && (tree !== record.tree || await git(folder, ['diff', '--name-only']) || await git(folder, ['ls-files', '--others', '--exclude-standard']))) throw new Error('Destination changes differ from the saved transfer. Inspect the retained worktree.');
          if (!dirty) await git(folder, ['read-tree', '--reset', '-u', record.tree]);
          await this.options.git.commit(folder, `${input.message.trim()}\n\nBranch-source: ${record.head}`);
          if (await git(folder, ['rev-parse', 'HEAD^{tree}']) !== record.tree) throw new Error('The commit changed the captured tree. Source work was retained.');
        }
        record.result.commit = await git(folder, ['rev-parse', 'HEAD']);
        await saveJournal(journalPath, record);
      }
      const provisioned = await this.options.provision(agent, input, folder);
      Object.assign(record.result, { taskId: provisioned.taskId, agentId: provisioned.agentId });
      await saveJournal(journalPath, record);
      if (!provisioned.accepted) throw new Error('Agent startup is unconfirmed. Inspect the retained agent before continuing; the task will not be replayed.');
      if (await git(source, ['rev-parse', 'HEAD']) !== record.head) throw new Error('Source HEAD changed. Keep the source changes and inspect the committed worktree.');
      await this.assertIdleRepository(source);
      for (const selected of input.paths) {
        if (record.cleaned.includes(selected)) continue;
        await this.safePath(source, selected);
        if (await this.fingerprint(source, selected) !== record.fingerprints[selected]) continue;
        const inHead = await git(source, ['ls-tree', '-z', record.head, '--', selected]);
        if (inHead) await git(source, ['restore', '--source', record.head, '--staged', '--worktree', '--', selected]);
        else {
          await git(source, ['rm', '--cached', '--ignore-unmatch', '--', selected]);
          await rm(path.join(source, selected), { force: true });
        }
        record.cleaned.push(selected);
        await saveJournal(journalPath, record);
      }
      record.result.retainedPaths = input.paths.filter(selected => !record.cleaned.includes(selected));
      record.result.state = 'completed';
      delete record.result.detail;
      await saveJournal(journalPath, record);
    } catch (error) {
      record.result.state = 'recovery';
      record.result.retainedPaths = input.paths.filter(selected => !record.cleaned.includes(selected));
      record.result.detail = error instanceof Error ? error.message : String(error);
      await saveJournal(journalPath, record);
    }
    return structuredClone(record.result);
  }

  private async root(folder: string): Promise<string> {
    return realpath(await git(folder, ['rev-parse', '--show-toplevel']));
  }
  private async assertIdleRepository(folder: string): Promise<void> {
    const unmerged = await git(folder, ['ls-files', '--unmerged']);
    if (unmerged) throw new Error('Resolve conflicts before branching.');
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'index.lock']) {
      const location = await git(folder, ['rev-parse', '--path-format=absolute', '--git-path', marker]);
      if (await exists(location)) throw new Error('Finish the active Git operation before branching.');
    }
  }
  private async capture(folder: string): Promise<Capture> {
    folder = await this.root(folder);
    await this.assertIdleRepository(folder);
    const head = await git(folder, ['rev-parse', '--verify', 'HEAD']);
    // Disable rename grouping: both sides of a rename remain explicit selectable paths.
    const output = await git(folder, ['-c', 'status.renames=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const files = output.split('\0').filter(Boolean).map(entry => ({ path: entry.slice(3), indexStatus: entry[0]!, worktreeStatus: entry[1]!, sensitive: sensitivePath(entry.slice(3)) }));
    const fingerprints: Record<string, string> = {};
    for (const file of files) {
      await this.safePath(folder, file.path);
      fingerprints[file.path] = await this.fingerprint(folder, file.path);
    }
    return { folder, head, files, fingerprints, snapshotId: hash(JSON.stringify({ folder, head, files, fingerprints })) };
  }
  private async safePath(root: string, selected: string): Promise<void> {
    if (!selected || selected.includes('\0') || selected.includes('\\') || path.isAbsolute(selected) || selected.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('Invalid transfer path.');
    for (const part of selected.split('/').slice(0, -1)) {
      root = path.join(root, part);
      const stat = await lstat(root).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && !stat.isDirectory()) throw new Error('Transfer paths must not pass through symlinks or files.');
    }
    const stat = await lstat(path.join(root, selected.split('/').at(-1)!)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat && !stat.isFile()) throw new Error('Only regular files can be transferred.');
  }
  private async fingerprint(folder: string, selected: string): Promise<string> {
    const index = await git(folder, ['ls-files', '--stage', '-z', '--', selected]);
    const file = path.join(folder, selected);
    const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const contents = stat ? hash(await readFile(file)) : 'deleted';
    return hash(JSON.stringify({ index, contents, executable: stat ? Boolean(stat.mode & 0o111) : false }));
  }
}

function sensitivePath(selected: string): boolean {
  return selected.split('/').some(part => /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i.test(part));
}
async function git(folder: string, args: string[], index?: string): Promise<string> {
  const { stdout } = await exec('git', ['--literal-pathspecs', ...args], { cwd: folder, env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) }, maxBuffer: 20 * 1024 * 1024 });
  return stdout.replace(/\n$/, '');
}
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function readJournal(file: string): Promise<Journal | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as Journal; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function saveJournal(file: string, journal: Journal): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(journal), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
