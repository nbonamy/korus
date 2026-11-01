import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SourceWorktree, WorktreeInitializationMode } from '@workspace/core/contracts';
import type { WorktreeInitializationState } from '@workspace/core/worktree-initialization';
import {
  createGitWorktree,
  type GitWorktreeCreateInput,
  listSourceBranches,
} from '../git-worktrees';

const execFileAsync = promisify(execFile);

type WorktreeInitializationSource = 'repository' | 'automatic' | 'none';

export type WorktreeInitializationProgress =
  | { phase: 'detecting' }
  | {
    phase: 'running';
    source: Exclude<WorktreeInitializationSource, 'none'>;
    command: string;
    commandIndex: number;
    commandCount: number;
  }
  | {
    phase: 'complete';
    source: WorktreeInitializationSource;
    commands: string[];
    copiedFiles: string[];
  };

export type PreparedWorktree = {
  worktree: SourceWorktree;
  created: boolean;
  initialization?: {
    source: WorktreeInitializationSource;
    commands: string[];
    copiedFiles: string[];
  };
};

export type WorktreeManagerOptions = {
  onInitializationChanged?: (folder: string, state: WorktreeInitializationState) => void;
  createGitWorktree?: typeof createGitWorktree;
  getInitializationMode?: () => WorktreeInitializationMode;
  listSourceBranches?: typeof listSourceBranches;
  platform?: NodeJS.Platform;
  runCommand?: WorktreeCommandRunner;
};

export type WorktreeCreateOptions = {
  backgroundInitialization?: boolean;
  /** Transfers must never copy environment files or run repository setup implicitly. */
  skipInitialization?: boolean;
  onInitializationProgress?: (progress: WorktreeInitializationProgress) => void;
};

type WorktreeCommand = {
  command: string;
  args: string[];
  display: string;
};

type WorktreeInitializationPlan = {
  source: Exclude<WorktreeInitializationSource, 'none'>;
  commands: WorktreeCommand[];
};

type WorktreeCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
) => Promise<{ stdout?: string; stderr?: string }>;

const defaultCommandRunner: WorktreeCommandRunner = (command, args, options) => execFileAsync(command, args, {
  ...options,
  maxBuffer: 10 * 1024 * 1024,
});

/** Owns the complete create-and-initialize lifecycle for a linked Git worktree. */
export class WorktreeManager {
  private readonly getInitializationMode: () => WorktreeInitializationMode;
  private readonly createGitWorktree: typeof createGitWorktree;
  private readonly listSourceBranches: typeof listSourceBranches;
  private readonly platform: NodeJS.Platform;
  private readonly runCommand: WorktreeCommandRunner;
  private readonly onInitializationChanged?: WorktreeManagerOptions['onInitializationChanged'];
  private readonly initializationStates = new Map<string, WorktreeInitializationState>();
  private readonly initializationJobs = new Map<string, { controller: AbortController; completion: Promise<void> }>();

  constructor(options: WorktreeManagerOptions = {}) {
    this.createGitWorktree = options.createGitWorktree ?? createGitWorktree;
    this.getInitializationMode = options.getInitializationMode ?? (() => 'off');
    this.listSourceBranches = options.listSourceBranches ?? listSourceBranches;
    this.platform = options.platform ?? process.platform;
    this.runCommand = options.runCommand ?? defaultCommandRunner;
    this.onInitializationChanged = options.onInitializationChanged;
  }

  async create(input: GitWorktreeCreateInput, options: WorktreeCreateOptions = {}): Promise<PreparedWorktree> {
    const created = await this.createGitWorktree(input);
    if (!created.created || options.skipInitialization) {
      return {
        ...created,
        initialization: { source: 'none', commands: [], copiedFiles: [] },
      };
    }

    if (options.backgroundInitialization) {
      const folder = path.resolve(created.worktree.path);
      const controller = new AbortController();
      this.updateInitialization(folder, { state: 'running' });
      const completion = this.initialize(input.repoPath, created.worktree.path, progress => {
        options.onInitializationProgress?.(progress);
        this.updateInitialization(folder, progress.phase === 'complete' ? { state: 'complete' }
          : { state: 'running', ...(progress.phase === 'running' ? { command: progress.command } : {}) });
      }, controller.signal).then(() => undefined, error => {
        this.updateInitialization(folder, {
          state: 'error',
          ...(this.initializationStates.get(folder)?.command ? { command: this.initializationStates.get(folder)!.command } : {}),
          error: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => { this.initializationJobs.delete(folder); });
      this.initializationJobs.set(folder, { controller, completion });
      return created;
    }
    const initialization = await this.initialize(
      input.repoPath,
      created.worktree.path,
      options.onInitializationProgress,
    );
    return { ...created, initialization };
  }

  getInitializationState(folder: string): WorktreeInitializationState | undefined {
    const state = this.initializationStates.get(path.resolve(folder));
    return state ? { ...state } : undefined;
  }

  async waitForInitialization(folder: string, signal?: AbortSignal): Promise<WorktreeInitializationState | undefined> {
    const key = path.resolve(folder);
    const completion = this.initializationJobs.get(key)?.completion;
    if (completion) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error('Waiting for worktree initialization was cancelled.'));
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        void completion.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
      });
    }
    const state = this.getInitializationState(key);
    if (state?.state === 'error') throw new Error(state.error ?? 'Worktree initialization failed.');
    return state;
  }

  async close(): Promise<void> {
    const jobs = [...this.initializationJobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map(job => job.completion));
  }

  private updateInitialization(folder: string, state: WorktreeInitializationState): void {
    this.initializationStates.set(folder, state);
    this.onInitializationChanged?.(folder, { ...state });
  }

  private async initialize(
    repositoryPath: string,
    worktreePath: string,
    onProgress?: (progress: WorktreeInitializationProgress) => void,
    signal?: AbortSignal,
  ): Promise<PreparedWorktree['initialization']> {
    const mode = this.getInitializationMode();
    if (mode === 'off') {
      const initialization = { source: 'none' as const, commands: [], copiedFiles: [] };
      onProgress?.({ phase: 'complete', ...initialization });
      return initialization;
    }

    onProgress?.({ phase: 'detecting' });
    const repositoryPlan = await this.repositoryPlan(worktreePath);
    if (repositoryPlan) {
      return this.runPlan(repositoryPlan, repositoryPath, worktreePath, [], onProgress, signal);
    }

    if (mode !== 'automatic') {
      const initialization = { source: 'none' as const, commands: [], copiedFiles: [] };
      onProgress?.({ phase: 'complete', ...initialization });
      return initialization;
    }

    const copiedFiles = await this.copyEnvironmentFiles(repositoryPath, worktreePath);
    const plan = await this.automaticPlan(worktreePath);
    if (!plan) {
      const initialization: PreparedWorktree['initialization'] = {
        source: copiedFiles.length > 0 ? 'automatic' : 'none',
        commands: [],
        copiedFiles,
      };
      onProgress?.({ phase: 'complete', ...initialization });
      return initialization;
    }

    return this.runPlan(plan, repositoryPath, worktreePath, copiedFiles, onProgress, signal);
  }

  private async runPlan(
    plan: WorktreeInitializationPlan,
    repositoryPath: string,
    worktreePath: string,
    copiedFiles: string[],
    onProgress?: (progress: WorktreeInitializationProgress) => void,
    signal?: AbortSignal,
  ): Promise<PreparedWorktree['initialization']> {
    const commands = plan.commands.map((command) => command.display);
    const environment = {
      ...process.env,
      AGENT_WORKTREE_PATH: worktreePath,
      AGENT_WORKTREE_SOURCE_PATH: repositoryPath,
      CI: process.env.CI ?? '1',
    };
    for (const [index, command] of plan.commands.entries()) {
      onProgress?.({
        phase: 'running',
        source: plan.source,
        command: command.display,
        commandIndex: index,
        commandCount: plan.commands.length,
      });
      signal?.throwIfAborted();
      await this.runCommand(command.command, command.args, { cwd: worktreePath, env: environment, ...(signal ? { signal } : {}) });
    }

    const initialization = { source: plan.source, commands, copiedFiles };
    onProgress?.({ phase: 'complete', ...initialization });
    return initialization;
  }

  private async copyEnvironmentFiles(repositoryPath: string, worktreePath: string): Promise<string[]> {
    const sourcePath = await this.environmentSourcePath(repositoryPath, worktreePath);
    if (!sourcePath) return [];
    return copyEnvironmentFiles(sourcePath, worktreePath);
  }

  private async environmentSourcePath(repositoryPath: string, worktreePath: string): Promise<string | null> {
    const branches = await this.listSourceBranches(repositoryPath).catch(() => []);
    const defaultWorktreePath = branches.find((branch) => (
      branch.isDefault
      && branch.worktreePath
      && !samePath(branch.worktreePath, worktreePath)
    ))?.worktreePath;
    if (defaultWorktreePath && await exists(defaultWorktreePath)) return defaultWorktreePath;
    if (!samePath(repositoryPath, worktreePath) && await exists(repositoryPath)) return repositoryPath;
    for (const branch of branches) {
      if (branch.worktreePath
        && !samePath(branch.worktreePath, worktreePath)
        && await exists(branch.worktreePath)) {
        return branch.worktreePath;
      }
    }
    return null;
  }

  private async repositoryPlan(worktreePath: string): Promise<WorktreeInitializationPlan | null> {
    const setupRoot = path.join(worktreePath, '.agents', 'worktree');
    const platformSetup = this.platform === 'darwin'
      ? 'setup-macos.sh'
      : this.platform === 'linux'
        ? 'setup-linux.sh'
        : this.platform === 'win32'
          ? 'setup-win.ps1'
          : null;
    const setupPath = platformSetup && await exists(path.join(setupRoot, platformSetup))
      ? path.join(setupRoot, platformSetup)
      : await exists(path.join(setupRoot, 'setup'))
        ? path.join(setupRoot, 'setup')
        : null;
    if (!setupPath) return null;

    const contents = await readFile(setupPath, 'utf8');
    if (!contents.trim()) return { source: 'repository', commands: [] };
    const relativePath = path.relative(worktreePath, setupPath);
    return {
      source: 'repository',
      commands: [this.scriptCommand(setupPath, relativePath, contents)],
    };
  }

  private scriptCommand(scriptPath: string, relativePath: string, contents: string): WorktreeCommand {
    if (this.platform === 'win32') {
      const scriptArgs = scriptPath.endsWith('.ps1')
        ? ['-File', scriptPath]
        : ['-Command', contents];
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...scriptArgs],
        display: relativePath,
      };
    }
    return { command: '/bin/sh', args: [scriptPath], display: relativePath };
  }

  private async automaticPlan(worktreePath: string): Promise<WorktreeInitializationPlan | null> {
    const commands = [
      ...await nodeCommands(worktreePath),
      ...await pythonCommands(worktreePath, this.platform),
      ...await goCommands(worktreePath),
    ];
    return commands.length > 0 ? { source: 'automatic', commands } : null;
  }
}

const environmentScanExcludedDirectories = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
  'venv',
]);

const environmentTemplateSuffixes = ['.dist', '.example', '.sample', '.template'];

async function copyEnvironmentFiles(sourcePath: string, worktreePath: string): Promise<string[]> {
  const relativePaths = await findEnvironmentFiles(sourcePath, worktreePath);
  const copiedFiles: string[] = [];
  for (const relativePath of relativePaths) {
    const destinationPath = path.join(worktreePath, relativePath);
    if (await exists(destinationPath)) continue;
    await mkdir(path.dirname(destinationPath), { recursive: true });
    try {
      await copyFile(path.join(sourcePath, relativePath), destinationPath, constants.COPYFILE_EXCL);
      copiedFiles.push(relativePath);
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }
  return copiedFiles;
}

async function findEnvironmentFiles(
  sourcePath: string,
  worktreePath: string,
  currentPath = sourcePath,
): Promise<string[]> {
  const environmentFiles: string[] = [];
  const entries = await readdir(currentPath, { withFileTypes: true });
  if (!samePath(currentPath, sourcePath) && entries.some((entry) => entry.name === '.git')) {
    return [];
  }
  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (environmentScanExcludedDirectories.has(entry.name) || isPathInside(entryPath, worktreePath)) continue;
      environmentFiles.push(...await findEnvironmentFiles(sourcePath, worktreePath, entryPath));
    } else if (entry.isFile() && isEnvironmentFile(entry.name)) {
      environmentFiles.push(path.relative(sourcePath, entryPath));
    }
  }
  return environmentFiles.sort((left, right) => left.localeCompare(right));
}

function isEnvironmentFile(fileName: string): boolean {
  if (fileName === '.env') return true;
  if (!fileName.startsWith('.env.')) return false;
  const normalized = fileName.toLowerCase();
  return !environmentTemplateSuffixes.some((suffix) => normalized.endsWith(suffix));
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function nodeCommands(worktreePath: string): Promise<WorktreeCommand[]> {
  const packageJsonPath = path.join(worktreePath, 'package.json');
  if (!await exists(packageJsonPath)) return [];

  const packageManager = await declaredPackageManager(packageJsonPath);
  const pnpmLock = await exists(path.join(worktreePath, 'pnpm-lock.yaml'));
  if (packageManager === 'pnpm' || (!packageManager && pnpmLock)) {
    return [command('pnpm', ['install', ...(pnpmLock ? ['--frozen-lockfile'] : [])])];
  }
  const yarnLock = await exists(path.join(worktreePath, 'yarn.lock'));
  if (packageManager === 'yarn' || (!packageManager && yarnLock)) {
    const immutable = await exists(path.join(worktreePath, '.yarnrc.yml'));
    return [command('yarn', ['install', ...(yarnLock ? [immutable ? '--immutable' : '--frozen-lockfile'] : [])])];
  }
  const bunLock = await exists(path.join(worktreePath, 'bun.lock')) || await exists(path.join(worktreePath, 'bun.lockb'));
  if (packageManager === 'bun' || (!packageManager && bunLock)) {
    return [command('bun', ['install', ...(bunLock ? ['--frozen-lockfile'] : [])])];
  }
  return [await exists(path.join(worktreePath, 'package-lock.json'))
    ? command('npm', ['ci'])
    : command('npm', ['install', '--package-lock=false'])];
}

async function pythonCommands(worktreePath: string, platform: NodeJS.Platform): Promise<WorktreeCommand[]> {
  if (await exists(path.join(worktreePath, 'uv.lock'))) return [command('uv', ['sync'])];
  if (await exists(path.join(worktreePath, 'poetry.lock'))) return [command('poetry', ['install'])];
  if (await exists(path.join(worktreePath, 'Pipfile.lock'))) return [command('pipenv', ['sync'])];
  if (!await exists(path.join(worktreePath, 'requirements.txt'))) return [];

  if (platform === 'win32') {
    return [
      command('py', ['-3', '-m', 'venv', '.venv']),
      command(path.join('.venv', 'Scripts', 'python.exe'), ['-m', 'pip', 'install', '-r', 'requirements.txt']),
    ];
  }
  return [
    command('python3', ['-m', 'venv', '.venv']),
    command(path.join('.venv', 'bin', 'python'), ['-m', 'pip', 'install', '-r', 'requirements.txt']),
  ];
}

async function goCommands(worktreePath: string): Promise<WorktreeCommand[]> {
  return await exists(path.join(worktreePath, 'go.mod')) ? [command('go', ['mod', 'download'])] : [];
}

async function declaredPackageManager(packageJsonPath: string): Promise<'npm' | 'pnpm' | 'yarn' | 'bun' | null> {
  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { packageManager?: unknown };
    if (typeof parsed.packageManager !== 'string') return null;
    const name = parsed.packageManager.split('@', 1)[0];
    return name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : null;
  } catch {
    return null;
  }
}

function command(executable: string, args: string[]): WorktreeCommand {
  return { command: executable, args, display: [executable, ...args].join(' ') };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
