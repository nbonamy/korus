import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorktreeManager, type WorktreeManagerOptions } from '../worktree-manager';

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

  it('uses the current-platform repository setup instead of the generic setup', async () => {
    await writeSetup('setup', 'npm install');
    await writeSetup('setup-macos.sh', 'make bootstrap');
    await writeFile(path.join(repositoryPath, '.env'), 'SHOULD_NOT_COPY=true\n');
    const runCommand = vi.fn().mockResolvedValue({});
    const listSourceBranches = vi.fn();
    const manager = createManager({ listSourceBranches, platform: 'darwin', runCommand });

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
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
    await manager.waitForInitialization(worktreePath);

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
    await manager.waitForInitialization(worktreePath);

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

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
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

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
    expect(await readFile(path.join(worktreePath, '.env'), 'utf8')).toBe('SOURCE=default\n');
    expect(await readFile(path.join(worktreePath, '.env.local'), 'utf8')).toBe('KEEP_EXISTING=true\n');
    expect(await readFile(path.join(worktreePath, 'apps', 'api', '.env.test'), 'utf8')).toBe('API_ENV=test\n');
    await expect(access(path.join(worktreePath, 'apps', 'api', '.env.example'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, 'node_modules', 'package', '.env'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, 'dist', '.env'))).rejects.toThrow();
    await expect(access(path.join(worktreePath, '.worktrees', 'other', '.env'))).rejects.toThrow();
    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('npm', ['ci'], expect.objectContaining({ cwd: worktreePath }));
  });

  it('initializes every detected root ecosystem in a stable sequence', async () => {
    await Promise.all([
      writeFile(path.join(worktreePath, 'package.json'), '{}'),
      writeFile(path.join(worktreePath, 'package-lock.json'), '{}'),
      writeFile(path.join(worktreePath, 'uv.lock'), ''),
      writeFile(path.join(worktreePath, 'go.mod'), 'module example.com/project\n'),
    ]);
    const runCommand = vi.fn().mockResolvedValue({});
    const onInitializationChanged = vi.fn();
    const manager = createManager({ runCommand, onInitializationChanged });

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
    expect(runCommand.mock.calls.map(([command, args]) => [command, args])).toStrictEqual([
      ['npm', ['ci']],
      ['uv', ['sync']],
      ['go', ['mod', 'download']],
    ]);
    expect(onInitializationChanged.mock.calls.map(([, state]) => state)).toStrictEqual([
      { state: 'running' },
      { state: 'running', command: 'npm ci' },
      { state: 'running', command: 'uv sync' },
      { state: 'running', command: 'go mod download' },
      { state: 'complete' },
    ]);
  });

  it('does not guess commands in repository-only mode', async () => {
    await writeFile(path.join(worktreePath, 'package.json'), '{}');
    await writeFile(path.join(repositoryPath, '.env'), 'SHOULD_NOT_COPY=true\n');
    const runCommand = vi.fn();
    const listSourceBranches = vi.fn();
    const manager = createManager({ listSourceBranches, mode: 'repository', runCommand });

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
    expect(listSourceBranches).not.toHaveBeenCalled();
    await expect(access(path.join(worktreePath, '.env'))).rejects.toThrow();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('does not inspect or initialize worktrees when initialization is off', async () => {
    await writeSetup('setup-linux.sh', 'make bootstrap');
    const runCommand = vi.fn();
    const manager = createManager({ mode: 'off', runCommand });

    await manager.create(createInput());
    await manager.waitForInitialization(worktreePath);
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
    expect(manager.getInitializationState(worktreePath)).toBeUndefined();
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

    await manager.create(createInput());
    await expect(manager.waitForInitialization(worktreePath)).rejects.toThrow(failure.message);
    expect(runCommand).toHaveBeenCalledOnce();
  });

  function createInput() {
    return { repoPath: repositoryPath, branchName: 'feature/demo' };
  }

  it.each([false, true])('returns a usable worktree while background setup runs and reports its outcome (failure: %s)', async fails => {
    await writeFile(path.join(worktreePath, 'package.json'), '{}');
    await writeFile(path.join(worktreePath, 'package-lock.json'), '{}');
    let release!: () => void;
    const runCommand = vi.fn(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      if (fails) throw new Error('npm ci failed');
      return {};
    });
    const manager = createManager({ runCommand, mode: 'automatic' });
    try {
      const created = await manager.create(createInput());
      expect(created.worktree.path).toBe(worktreePath);
      await vi.waitFor(() => expect(runCommand).toHaveBeenCalledOnce());
      expect(manager.getInitializationState(worktreePath)).toStrictEqual({ state: 'running', command: 'npm ci' });
      let finished = false;
      const wait = manager.waitForInitialization(worktreePath).then(() => { finished = true; }, () => { finished = true; });
      await Promise.resolve();
      expect(finished).toBe(false);
      release();
      await wait;
      expect(manager.getInitializationState(worktreePath)).toStrictEqual(fails
        ? { state: 'error', command: 'npm ci', error: 'npm ci failed' }
        : { state: 'complete' });
      if (fails) await expect(manager.waitForInitialization(worktreePath)).rejects.toThrow('npm ci failed');
    } finally { release?.(); await manager.close(); }
  });

  it('stops setup that is still running when its worktree is about to be removed', async () => {
    await writeFile(path.join(worktreePath, 'package.json'), '{}');
    await writeFile(path.join(worktreePath, 'package-lock.json'), '{}');
    let stopped = false;
    const runCommand: NonNullable<WorktreeManagerOptions['runCommand']> = vi.fn((_command, _args, options) => new Promise<Record<string, never>>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { stopped = true; reject(new Error('aborted')); });
    }));
    const manager = createManager({ runCommand, mode: 'automatic' });
    try {
      await manager.create(createInput());
      await vi.waitFor(() => expect(runCommand).toHaveBeenCalledOnce());
      await manager.cancelInitialization(worktreePath);
      expect(stopped).toBe(true);
      expect(manager.getInitializationState(worktreePath)).toBeUndefined();
      await expect(manager.cancelInitialization(worktreePath)).resolves.toBeUndefined();
    } finally { await manager.close(); }
  });

  function createManager(options: {
    listSourceBranches?: WorktreeManagerOptions['listSourceBranches'];
    mode?: 'automatic' | 'repository' | 'off';
    onInitializationChanged?: WorktreeManagerOptions['onInitializationChanged'];
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
      onInitializationChanged: options.onInitializationChanged,
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
