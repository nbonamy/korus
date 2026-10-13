import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeManager, type WorktreeInitializationProgress, type WorktreeManagerOptions } from '../worktree-manager';

describe('WorktreeManager', () => {
  let root: string;
  let repositoryPath: string;
  let worktreePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'app-worktree-manager-'));
    repositoryPath = path.join(root, 'repo');
    worktreePath = path.join(root, 'repo-feature');
    await mkdir(repositoryPath);
    await mkdir(worktreePath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('skips setup and environment copying when a transfer opts out of initialization', async () => {
    await writeSetup('setup', 'echo setup');
    await writeFile(path.join(repositoryPath, '.env'), 'SYNTHETIC=true');
    const runCommand = vi.fn();
    const manager = createManager({ runCommand });
    const result = await manager.create(createInput(), { skipInitialization: true });
    expect(result.initialization).toStrictEqual({ source: 'none', commands: [], copiedFiles: [] });
    expect(runCommand).not.toHaveBeenCalled();
    await expect(access(path.join(worktreePath, '.env'))).rejects.toThrow();
  });

  it('uses the current-platform repository setup instead of the generic setup', async () => {
    await writeSetup('setup', 'npm install');
    await writeSetup('setup-macos.sh', 'make bootstrap');
    await writeFile(path.join(repositoryPath, '.env'), 'SHOULD_NOT_COPY=true\n');
    const runCommand = vi.fn().mockResolvedValue({});
    const listSourceBranches = vi.fn();
    const manager = createManager({ listSourceBranches, platform: 'darwin', runCommand });

    const result = await manager.create(createInput());

    expect(result.initialization).toStrictEqual({
      source: 'repository',
      commands: [path.join('.agents', 'worktree', 'setup-macos.sh')],
      copiedFiles: [],
    });
    expect(listSourceBranches).not.toHaveBeenCalled();
    await expect(access(path.join(worktreePath, '.env'))).rejects.toThrow();
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith(
      '/bin/sh',
      [path.join(worktreePath, '.agents', 'worktree', 'setup-macos.sh')],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it('uses the generic repository setup when no platform override exists', async () => {
    await writeSetup('setup', 'npm install');
    const runCommand = vi.fn().mockResolvedValue({});
    const manager = createManager({ platform: 'linux', runCommand });

    await manager.create(createInput());

    expect(runCommand).toHaveBeenCalledWith(
      '/bin/sh',
      [path.join(worktreePath, '.agents', 'worktree', 'setup')],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it('runs extensionless setup as PowerShell command text on Windows', async () => {
    await writeSetup('setup', 'npm install\npython -m pip install -r requirements.txt');
    const runCommand = vi.fn().mockResolvedValue({});
    const manager = createManager({ platform: 'win32', runCommand });

    await manager.create(createInput());

    expect(runCommand).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'npm install\npython -m pip install -r requirements.txt',
      ],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it('treats an empty repository setup as an intentional no-op', async () => {
    await writeSetup('setup', '\n');
    await writeFile(path.join(worktreePath, 'package.json'), '{}');
    const runCommand = vi.fn();
    const manager = createManager({ runCommand });

    const result = await manager.create(createInput());

    expect(result.initialization).toStrictEqual({ source: 'repository', commands: [], copiedFiles: [] });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('copies local environment files from the default-branch worktree before automatic setup', async () => {
    const defaultWorktreePath = path.join(root, 'repo-main');
    await Promise.all([
      mkdir(path.join(defaultWorktreePath, 'apps', 'api'), { recursive: true }),
      mkdir(path.join(defaultWorktreePath, 'node_modules', 'package'), { recursive: true }),
      mkdir(path.join(defaultWorktreePath, 'dist'), { recursive: true }),
      mkdir(path.join(defaultWorktreePath, '.worktrees', 'other'), { recursive: true }),
      mkdir(path.join(worktreePath, 'apps', 'api'), { recursive: true }),
      writeFile(path.join(repositoryPath, '.env'), 'SOURCE=repository\n'),
      writeFile(path.join(worktreePath, 'package.json'), '{}'),
      writeFile(path.join(worktreePath, 'package-lock.json'), '{}'),
    ]);
    await Promise.all([
      writeFile(path.join(defaultWorktreePath, '.env'), 'SOURCE=default\n'),
      writeFile(path.join(defaultWorktreePath, '.env.local'), 'DEFAULT_LOCAL=true\n'),
      writeFile(path.join(defaultWorktreePath, 'apps', 'api', '.env.test'), 'API_ENV=test\n'),
      writeFile(path.join(defaultWorktreePath, 'apps', 'api', '.env.example'), 'TEMPLATE=true\n'),
      writeFile(path.join(defaultWorktreePath, 'node_modules', 'package', '.env'), 'DEPENDENCY=true\n'),
      writeFile(path.join(defaultWorktreePath, 'dist', '.env'), 'BUILD=true\n'),
      writeFile(path.join(defaultWorktreePath, '.worktrees', 'other', '.git'), 'gitdir: elsewhere\n'),
      writeFile(path.join(defaultWorktreePath, '.worktrees', 'other', '.env'), 'OTHER_WORKTREE=true\n'),
      writeFile(path.join(worktreePath, '.env.local'), 'KEEP_EXISTING=true\n'),
    ]);
    const listSourceBranches = vi.fn().mockResolvedValue([
      { name: 'main', isDefault: true, worktreePath: defaultWorktreePath },
      { name: 'feature/demo', isDefault: false, worktreePath: worktreePath },
    ]);
    const runCommand = vi.fn(async () => {
      expect(await readFile(path.join(worktreePath, '.env'), 'utf8')).toBe('SOURCE=default\n');
      return {};
    });
    const manager = createManager({ listSourceBranches, runCommand });

    const result = await manager.create(createInput());

    expect(result.initialization).toStrictEqual({
      source: 'automatic',
      commands: ['npm ci'],
      copiedFiles: ['.env', path.join('apps', 'api', '.env.test')],
    });
    expect(await readFile(path.join(worktreePath, '.env'), 'utf8')).toBe('SOURCE=default\n');
    expect(await readFile(path.join(worktreePath, '.env.local'), 'utf8')).toBe('KEEP_EXISTING=true\n');
    expect(await readFile(path.join(worktreePath, 'apps', 'api', '.env.test'), 'utf8')).toBe('API_ENV=test\n');
    await expect(access(path.join(worktreePath, 'apps', 'api', '.env.example'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, 'node_modules', 'package', '.env'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, 'dist', '.env'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, '.worktrees', 'other', '.env'))).rejects.toThrow();
    expect(runCommand).toHaveBeenCalledOnce();
  });

  it('initializes every detected root ecosystem in a stable sequence', async () => {
    await Promise.all([
      writeFile(path.join(worktreePath, 'package.json'), '{}'),
      writeFile(path.join(worktreePath, 'package-lock.json'), '{}'),
      writeFile(path.join(worktreePath, 'uv.lock'), ''),
      writeFile(path.join(worktreePath, 'go.mod'), 'module example.com/project\n'),
    ]);
    const runCommand = vi.fn().mockResolvedValue({});
    const progress: WorktreeInitializationProgress[] = [];
    const manager = createManager({ runCommand });

    const result = await manager.create(createInput(), {
      onInitializationProgress: (event) => progress.push(event),
    });

    expect(result.initialization).toStrictEqual({
      source: 'automatic',
      commands: ['npm ci', 'uv sync', 'go mod download'],
      copiedFiles: [],
    });
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toStrictEqual([
      ['npm', ['ci']],
      ['uv', ['sync']],
      ['go', ['mod', 'download']],
    ]);
    expect(progress).toStrictEqual([
      { phase: 'detecting' },
      { phase: 'running', source: 'automatic', command: 'npm ci', commandIndex: 0, commandCount: 3 },
      { phase: 'running', source: 'automatic', command: 'uv sync', commandIndex: 1, commandCount: 3 },
      { phase: 'running', source: 'automatic', command: 'go mod download', commandIndex: 2, commandCount: 3 },
      { phase: 'complete', source: 'automatic', commands: ['npm ci', 'uv sync', 'go mod download'], copiedFiles: [] },
    ]);
  });

  it('does not guess commands in repository-only mode', async () => {
    await writeFile(path.join(worktreePath, 'package.json'), '{}');
    await writeFile(path.join(repositoryPath, '.env'), 'SHOULD_NOT_COPY=true\n');
    const runCommand = vi.fn();
    const listSourceBranches = vi.fn();
    const manager = createManager({ listSourceBranches, mode: 'repository', runCommand });

    await expect(manager.create(createInput())).resolves.toMatchObject({
      initialization: { source: 'none', commands: [], copiedFiles: [] },
    });
    expect(listSourceBranches).not.toHaveBeenCalled();
    await expect(access(path.join(worktreePath, '.env'))).rejects.toThrow();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('does not inspect or initialize worktrees when initialization is off', async () => {
    await writeSetup('setup-linux.sh', 'make bootstrap');
    const runCommand = vi.fn();
    const manager = createManager({ mode: 'off', runCommand });

    await expect(manager.create(createInput())).resolves.toMatchObject({
      initialization: { source: 'none', commands: [], copiedFiles: [] },
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('does not initialize an existing worktree returned by Git', async () => {
    const runCommand = vi.fn();
    const createGitWorktree = vi.fn().mockResolvedValue({
      worktree: { name: 'feature/demo', path: worktreePath },
      created: false,
    });
    const manager = new WorktreeManager({
      createGitWorktree,
      getInitializationMode: () => 'automatic',
      runCommand,
    });

    const result = await manager.create(createInput());

    expect(result.created).toBe(false);
    expect(result.initialization).toStrictEqual({ source: 'none', commands: [], copiedFiles: [] });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('stops after a failed initialization command', async () => {
    await Promise.all([
      writeFile(path.join(worktreePath, 'package.json'), '{}'),
      writeFile(path.join(worktreePath, 'package-lock.json'), '{}'),
      writeFile(path.join(worktreePath, 'go.mod'), 'module example.com/project\n'),
    ]);
    const failure = new Error('npm failed');
    const runCommand = vi.fn().mockRejectedValueOnce(failure);
    const manager = createManager({ runCommand });

    await expect(manager.create(createInput())).rejects.toBe(failure);
    expect(runCommand).toHaveBeenCalledOnce();
  });

  function createInput() {
    return { repoPath: repositoryPath, branchName: 'feature/demo' };
  }

  function createManager(options: {
    listSourceBranches?: WorktreeManagerOptions['listSourceBranches'];
    mode?: 'automatic' | 'repository' | 'off';
    platform?: NodeJS.Platform;
    runCommand: NonNullable<WorktreeManagerOptions['runCommand']>;
  }): WorktreeManager {
    return new WorktreeManager({
      createGitWorktree: vi.fn().mockResolvedValue({
        worktree: { name: 'demo', path: worktreePath },
        created: true,
      }),
      getInitializationMode: () => options.mode ?? 'automatic',
      ...(options.listSourceBranches ? { listSourceBranches: options.listSourceBranches } : {}),
      platform: options.platform ?? 'linux',
      runCommand: options.runCommand,
    });
  }

  async function writeSetup(name: string, contents: string): Promise<void> {
    const setupRoot = path.join(worktreePath, '.agents', 'worktree');
    await mkdir(setupRoot, { recursive: true });
    await writeFile(path.join(setupRoot, name), contents);
  }
});
