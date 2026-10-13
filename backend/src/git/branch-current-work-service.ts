import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, open, lstat, mkdir, readFile, readdir, readlink, realpath, rename, symlink, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Agent, AgentGitFile } from '@workspace/core/contracts';
import type { BranchWorkInput, BranchWorkPreview, BranchWorkResult, BranchWorkProgress } from '@workspace/core/branch-current-work';
import { suggestedSourceWorktreePath } from '../git-worktrees';
import { WorktreeManager } from '../worktrees/worktree-manager';

const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Capture = BranchWorkPreview & { files: AgentGitFile[]; fingerprints: Record<string, string> };
type Journal = {
  schemaVersion: 2; input: BranchWorkInput; owner: string; specification: string; source: string; head: string; tree: string; indexTree: string; workerAgentId: string; paths: string[]; capturedFolder: string; intentToAdd: string[]; materialized: boolean;
  fingerprints: Record<string, string>; cleaned: string[];
  result: BranchWorkResult;
};
type Options = {
  progress?(progress: BranchWorkProgress): void;
  provision(agent: Agent, input: BranchWorkInput, folder: string, agentId: string): Promise<void>;
};

/** Recoverable local transfer. Captured paths are restored; source HEAD never moves. */
export class BranchCurrentWorkService {
  private readonly active = new Map<string, Promise<BranchWorkResult>>();
  constructor(private readonly options: Options) {}

  async preview(folder: string, agentId?: string): Promise<BranchWorkPreview> {
    const { fingerprints: _fingerprints, files: _files, ...preview } = await this.capture(folder);
    if (agentId) {
      const common = await git(preview.folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
      const root = path.join(common, 'korus', 'branch-transfers');
      const entries = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const records = await Promise.all(entries.filter(file => file.endsWith('.move.json')).map(file => readJournal(path.join(root, file))));
      const recoveries = records.filter(record => record?.owner === agentId && record.source === preview.folder && record.result.state === 'recovery').map(record => ({ input: record!.input, result: record!.result }));
      if (recoveries.length) preview.recoveries = recoveries;
    }
    return preview;
  }

  execute(agent: Agent, input: BranchWorkInput): Promise<BranchWorkResult> {
    const key = JSON.stringify([agent.id, input.requestId]);
    // Serialize all transfers for a source checkout, including different request IDs.
    const source = agent.folder ?? '';
    const previous = this.active.get(source);
    const operation = (previous ?? Promise.resolve()).catch(() => undefined).then(async () => {
      let phase: BranchWorkProgress['phase'] = 'creatingWorktree';
      const publish = (state: BranchWorkProgress['state'], error?: string) => this.options.progress?.({ id: input.requestId, agentId: agent.id, branchName: input.branchName, state, phase, ...(error ? { error } : {}) });
      publish('running');
      try {
        const result = await this.transfer(agent, input, key, next => { phase = next; publish('running'); });
        publish(result.state === 'completed' ? 'success' : 'error', result.detail);
        return result;
      } catch (error) {
        publish('error', error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
    this.active.set(source, operation);
    void operation.finally(() => { if (this.active.get(source) === operation) this.active.delete(source); }).catch(() => undefined);
    return operation;
  }

  private async transfer(agent: Agent, input: BranchWorkInput, key: string, progress: (phase: BranchWorkProgress['phase']) => void): Promise<BranchWorkResult> {
    if (input.confirmed !== true || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId !== input.requestId.trim() || input.requestId.length > 180) throw new Error('Confirm a branch name before moving current work.');
    if (!agent.folder) throw new Error('Choose a repository first.');
    const source = await this.root(agent.folder);
    const common = await git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const journalPath = path.join(common, 'korus', 'branch-transfers', `${hash(key)}.move.json`);
    const specification = hash(JSON.stringify(input));
    let journal = await readJournal(journalPath);
    if (journal && journal.specification !== specification) throw new Error('This requestId belongs to a different transfer.');
    if (journal && journal.source !== source) throw new Error('The source checkout changed. Recover from the original checkout.');
    if (journal?.result.state === 'completed') return journal.result;
    if (!journal) {
      const captured = await this.capture(source);
      if (input.snapshotId !== captured.snapshotId) throw new Error('The checkout changed. Refresh before branching.');
      if (typeof input.branchName !== 'string' || !input.branchName.trim() || input.branchName.length > 200 || input.branchName !== input.branchName.trim() || input.branchName.startsWith('-')) throw new Error('Enter a valid branch name.');
      await git(source, ['check-ref-format', '--branch', input.branchName]);
      const refs = await git(source, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
      if (refs.split('\n').some(ref => ref === `refs/heads/${input.branchName}` || ref.endsWith(`/${input.branchName}`))) throw new Error('That branch already exists.');
      const folder = suggestedSourceWorktreePath(source, input.branchName);
      if (await exists(folder)) throw new Error('The destination folder already exists. Choose another branch name.');
      const paths = captured.files.map(file => file.path);
      const index = path.join(common, `korus-branch-index-${randomUUID()}`);
      let tree: string;
      let indexTree: string;
      const capturedFolder = `${journalPath}.${randomUUID()}.files`;
      const intentToAdd = (await git(source, ['diff', '--name-only', '--diff-filter=A', '-z'])).split('\0').filter(Boolean);
      try {
        // Snapshot the real staging state separately from the final working files.
        const sourceIndex = await git(source, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
        await copyFile(sourceIndex, index);
        indexTree = await git(source, ['write-tree'], index);
        await git(source, ['read-tree', captured.head], index);
        if (paths.length) await git(source, ['add', '-A', '--', ...paths], index);
        tree = await git(source, ['write-tree'], index);
        await mkdir(capturedFolder, { recursive: true, mode: 0o700 });
        for (const selected of paths) {
          const file = path.join(source, selected);
          const copy = path.join(capturedFolder, selected);
          if (await exists(file)) {
            await mkdir(path.dirname(copy), { recursive: true, mode: 0o700 });
            await copyEntry(file, copy);
          }
          if (await this.fingerprint(source, selected, copy) !== captured.fingerprints[selected]) throw new Error('The checkout changed while copying. Refresh before branching.');
        }
        if ((await this.capture(source)).snapshotId !== captured.snapshotId) throw new Error('The checkout changed while capturing. Refresh before branching.');
      } catch (error) { await rm(capturedFolder, { recursive: true, force: true }); throw error; }
      finally { await rm(index, { force: true }); }
      journal = { schemaVersion: 2, input: structuredClone(input), owner: agent.id, specification, source, head: captured.head, tree, indexTree, workerAgentId: `agent-${randomUUID()}`, paths, capturedFolder, intentToAdd, materialized: false, fingerprints: captured.fingerprints, cleaned: [], result: { state: 'recovery', branchName: input.branchName, folder, retainedPaths: [...paths] } };
      for (const [name, value] of [['files', tree], ['index', indexTree]]) await git(source, ['update-ref', `refs/korus/branch-transfers/${hash(key)}/${name}`, value!]);
      await saveJournal(journalPath, journal);
    }
    const record = journal;
    try {
      const folder = record.result.folder;
      if (!await exists(folder)) {
        // No setup scripts or automatic environment copying in a transfer.
        await new WorktreeManager().create({ repoPath: source, branchName: input.branchName, destinationPath: folder, startPoint: record.head, requireNewBranch: true }, { skipInitialization: true });
        const marker = await git(folder, ['rev-parse', '--path-format=absolute', '--git-path', 'korus-branch-transfer']);
        await writeFile(marker, `${hash(key)}:${specification}`, { flag: 'wx', mode: 0o600 });
      }
      if (await this.root(folder) !== await realpath(folder) || await git(folder, ['symbolic-ref', '--short', 'HEAD']) !== input.branchName) throw new Error('The recovery destination is no longer the expected worktree.');
      const marker = await git(folder, ['rev-parse', '--path-format=absolute', '--git-path', 'korus-branch-transfer']);
      if (await readFile(marker, 'utf8').catch(() => '') !== `${hash(key)}:${specification}`) throw new Error('Worktree ownership is unconfirmed. Inspect the retained destination; source changes were preserved.');
      progress('movingChanges');
      if (await git(folder, ['rev-parse', 'HEAD']) !== record.head) throw new Error('Destination HEAD changed. Inspect the retained worktree.');
      if (!record.materialized) {
        const indexTree = await git(folder, ['write-tree']);
        const dirty = await git(folder, ['status', '--porcelain']);
        if (!dirty && indexTree === await git(folder, ['rev-parse', 'HEAD^{tree}'])) {
          // Checkout final file contents, then restore the original staging state.
          await git(folder, ['read-tree', '--reset', '-u', record.tree]);
          await this.restoreCapturedFiles(record);
          await git(folder, ['read-tree', record.indexTree]);
          if (record.intentToAdd.length) await git(folder, ['add', '--intent-to-add', '--', ...record.intentToAdd]);
        } else if (indexTree === record.tree && !await git(folder, ['diff', '--name-only']) && !await git(folder, ['ls-files', '--others', '--exclude-standard'])) {
          // Recover an interrupted staging-state restoration.
          await this.restoreCapturedFiles(record);
          await git(folder, ['read-tree', record.indexTree]);
          if (record.intentToAdd.length) await git(folder, ['add', '--intent-to-add', '--', ...record.intentToAdd]);
        }
        await this.assertDestination(record);
        record.materialized = true;
        await saveJournal(journalPath, record);
      }
      await this.assertDestination(record);
      progress('creatingAgent');
      await this.options.provision(agent, input, folder, record.workerAgentId);
      record.result.agentId = record.workerAgentId;
      await saveJournal(journalPath, record);
      await this.assertDestination(record);
      progress('resettingSource');
      if (await git(source, ['rev-parse', 'HEAD']) !== record.head) throw new Error('Source HEAD changed. Keep the source changes and inspect the new worktree.');
      await this.assertIdleRepository(source);
      for (const selected of record.paths) {
        if (record.cleaned.includes(selected)) continue;
        await this.safePath(source, selected);
        if (await this.fingerprint(source, selected) !== record.fingerprints[selected]) continue;
        record.result.sourceBackupFolder ??= `${journalPath}.source-backups`;
        await saveJournal(journalPath, record);
        if (!await this.cleanPath(record, selected)) continue;
        record.cleaned.push(selected);
        await saveJournal(journalPath, record);
      }
      record.result.retainedPaths = record.paths.filter(selected => !record.cleaned.includes(selected));
      record.result.state = 'completed';
      delete record.result.detail;
      await saveJournal(journalPath, record);
      for (const name of ['files', 'index']) await git(source, ['update-ref', '-d', `refs/korus/branch-transfers/${hash(key)}/${name}`]).catch(() => undefined);
      await rm(record.capturedFolder, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      record.result.state = 'recovery';
      record.result.retainedPaths = record.paths.filter(selected => !record.cleaned.includes(selected));
      record.result.detail = error instanceof Error ? error.message : String(error);
      await saveJournal(journalPath, record);
    }
    return structuredClone(record.result);
  }

  private async restoreCapturedFiles(record: Journal): Promise<void> {
    // Git filters can change checkout bytes. Preserve the actual files being moved.
    for (const selected of record.paths) {
      await this.safePath(record.result.folder, selected);
      const original = path.join(record.capturedFolder, selected);
      const destination = path.join(record.result.folder, selected);
      await rm(destination, { force: true });
      if (await exists(original)) {
        await mkdir(path.dirname(destination), { recursive: true });
        await copyEntry(original, destination);
      }
    }
  }

  private async assertDestination(record: Journal): Promise<void> {
    const folder = record.result.folder;
    await this.assertIdleRepository(folder);
    if (await git(folder, ['write-tree']) !== record.indexTree) throw new Error('Destination staging changed. Source work was retained.');
    for (const selected of record.paths) {
      await this.safePath(folder, selected);
      if (await this.fingerprint(folder, selected) !== record.fingerprints[selected]) throw new Error('Destination changes differ from the saved move. Source work was retained.');
    }
    const untracked = (await git(folder, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    if (untracked.some(file => !record.paths.includes(file)) || await git(folder, ['diff', '--name-only', '-z']).then(value => value.split('\0').filter(Boolean).some(file => !record.paths.includes(file)))) throw new Error('Destination has additional changes. Source work was retained.');
  }

  private async cleanPath(record: Journal, selected: string): Promise<boolean> {
    const source = record.source;
    const indexPath = await git(source, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    const lock = `${indexPath}.lock`;
    const handle = await open(lock, 'wx', 0o600);
    const temporary = `${lock}.${randomUUID()}`;
    const restoreRoot = `${temporary}.files`;
    const original = path.join(source, selected);
    const backup = path.join(record.result.sourceBackupFolder!, selected);
    try {
      // Hold the real index lock while preparing a path-only update in an alternate index.
      if (await this.fingerprint(source, selected) !== record.fingerprints[selected]) return false;
      await mkdir(record.result.sourceBackupFolder!, { recursive: true, mode: 0o700 });
      await copyFile(indexPath, temporary);
      const inHead = await git(source, ['ls-tree', '-z', record.head, '--', selected]);
      if (inHead) {
        const [mode, , object] = inHead.split('\t')[0]!.split(' ');
        // Recreate this entry without reusing the old working-file stat cache.
        await git(source, ['update-index', '--add', '--cacheinfo', mode!, object!, selected], temporary);
      } else await git(source, ['update-index', '--force-remove', '--', selected], temporary);
      if (inHead) {
        await mkdir(restoreRoot, { recursive: true, mode: 0o700 });
        await git(source, ['checkout-index', `--prefix=${restoreRoot}/`, '--', selected], temporary);
      }
      if (await exists(original)) {
        await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
        if (await exists(backup)) throw new Error('A source backup already exists. Inspect the recovery folder before retrying cleanup.');
        await rename(original, backup);
        // An editor can write between validation and rename. Retain its inode,
        // including later writes through an already-open descriptor, in the backup.
        if (await this.fingerprint(source, selected, backup) !== record.fingerprints[selected]) {
          try { await copyEntry(backup, original); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          return false;
        }
      }
      if (await exists(original)) return false;
      if (inHead) {
        await mkdir(path.dirname(original), { recursive: true });
        try { await copyEntry(path.join(restoreRoot, selected), original); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      }
      await rename(temporary, indexPath);
      return true;
    } finally {
      await handle.close();
      await rm(lock, { force: true });
      await rm(temporary, { force: true });
      await rm(restoreRoot, { recursive: true, force: true });
    }
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
    // Disable rename grouping: both sides of a rename are captured.
    const output = await git(folder, ['-c', 'status.renames=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const files = output.split('\0').filter(Boolean).map(entry => ({ path: entry.slice(3), indexStatus: entry[0]!, worktreeStatus: entry[1]! }));
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
    if (stat && !stat.isFile() && !stat.isSymbolicLink()) throw new Error('Directories and submodule changes cannot be transferred. Use a regular checkout.');
  }
  private async fingerprint(folder: string, selected: string, contentPath?: string): Promise<string> {
    const index = await git(folder, ['ls-files', '--stage', '-z', '--', selected]);
    const file = contentPath ?? path.join(folder, selected);
    const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const contents = stat?.isSymbolicLink() ? hash(await readlink(file)) : stat ? hash(await readFile(file)) : 'deleted';
    return hash(JSON.stringify({ index, contents, symlink: stat?.isSymbolicLink() ?? false, executable: stat ? Boolean(stat.mode & 0o111) : false }));
  }
}

async function git(folder: string, args: string[], index?: string): Promise<string> {
  const { stdout } = await exec('git', ['--literal-pathspecs', ...args], { cwd: folder, env: { ...process.env, ...(index ? { GIT_INDEX_FILE: index } : {}) }, maxBuffer: 20 * 1024 * 1024 });
  return stdout.replace(/\n$/, '');
}
async function copyEntry(source: string, destination: string): Promise<void> {
  if ((await lstat(source)).isSymbolicLink()) await symlink(await readlink(source), destination);
  else await copyFile(source, destination, constants.COPYFILE_EXCL);
}
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function readJournal(file: string): Promise<Journal | undefined> {
  try {
    const record = JSON.parse(await readFile(file, 'utf8')) as Journal;
    if (record.schemaVersion !== 2) throw new Error('Unsupported branch transfer recovery record. Inspect the retained worktree.');
    return record;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
async function saveJournal(file: string, journal: Journal): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(journal), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
