import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { acquireRepository } from '../projects/repository-acquisition';
import { cloneSourceRepository, repositoryNameFromUrl } from '../clone-source-repository';

describe('cloneSourceRepository', () => {
  it('reuses the complete GitLab identity across SSH/HTTPS and rejects same-name host or subgroup collisions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitlab-acquisition-'));
    const run = promisify(execFile); const destination = path.join(root, 'repo');
    try {
      await run('git', ['init', destination]);
      await run('git', ['remote', 'add', 'origin', 'git@gitlab.com:group/subgroup/repo.git'], { cwd: destination });
      const existing = await cloneSourceRepository(root, 'https://gitlab.com/group/subgroup/repo');
      expect(existing.path).toBe(destination);
      expect(existing.remoteIdentity).toBe('gitlab.com/group/subgroup/repo');
      await expect(acquireRepository('https://gitlab.com/group/subgroup/repo', true, {
        repositories: async () => [{ ...existing, path: path.join(root, 'renamed') }],
        clone: async () => { throw new Error('must reuse'); },
      })).resolves.toMatchObject({ path: path.join(root, 'renamed') });
      for (const url of ['https://github.com/group/subgroup/repo', 'https://gitlab.com/group/other/repo']) {
        await expect(cloneSourceRepository(root, url)).rejects.toMatchObject({ descriptor: { code: 'clone.alreadyExists' } });
      }
      expect((await run('git', ['remote', 'get-url', 'origin'], { cwd: destination })).stdout.trim()).toBe('git@gitlab.com:group/subgroup/repo.git');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('derives repository names from HTTPS and SSH URLs', () => {
    expect(repositoryNameFromUrl('https://github.com/nbonamy/agent-workspace.git')).toBe('agent-workspace');
    expect(repositoryNameFromUrl('git@github.com:nbonamy/agent-workspace.git')).toBe('agent-workspace');
  });

  it('clones into the source folder and returns the discovered repository', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-clone-'));
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'clone') {
        const destination = args.at(-1)!;
        await mkdir(path.join(destination, '.git'), { recursive: true });
        await writeFile(path.join(destination, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      }
      return { stdout: '' };
    });

    await expect(cloneSourceRepository(
      sourceRoot,
      'https://github.com/nbonamy/agent-workspace.git',
      { run },
    )).resolves.toStrictEqual({
      name: 'agent-workspace',
      path: path.join(sourceRoot, 'agent-workspace'),
      worktrees: [{ name: 'main', path: path.join(sourceRoot, 'agent-workspace') }],
    });
    expect(run).toHaveBeenCalledWith('git', [
      'clone',
      '--',
      'git@github.com:nbonamy/agent-workspace.git',
      path.join(sourceRoot, 'agent-workspace'),
    ], { cwd: sourceRoot, env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: expect.stringContaining('StrictHostKeyChecking=accept-new') }) });
  });

  describe('transport', () => {
    const clonedInto = async (args: string[]) => {
      const destination = args.at(-1)!;
      await mkdir(path.join(destination, '.git'), { recursive: true });
      await writeFile(path.join(destination, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    };
    const failure = (stderr: string) => Object.assign(new Error('Command failed'), { stderr });
    const cloneArgs = (run: ReturnType<typeof vi.fn>) => run.mock.calls.filter(call => call[1][0] === 'clone').map(call => call[1][2] as string);

    it('tries SSH first for GitHub and GitLab and trusts a new host key without prompting', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-ssh-'));
      const run = vi.fn(async (_command: string, args: string[], _options: { cwd: string; env?: NodeJS.ProcessEnv }) => { if (args[0] === 'clone') await clonedInto(args); return { stdout: '' }; });
      await cloneSourceRepository(root, 'https://gitlab.com/group/sub/project', { run });
      expect(cloneArgs(run)).toStrictEqual(['git@gitlab.com:group/sub/project.git']);
      const env = run.mock.calls.find(call => call[1][0] === 'clone')![2].env as Record<string, string>;
      expect(env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
      expect(env.GIT_SSH_COMMAND).toContain('StrictHostKeyChecking=accept-new');
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    });

    it('falls back to HTTPS when SSH fails', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-fallback-'));
      const run = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] !== 'clone') return { stdout: '' };
        if (args[2]!.startsWith('git@')) throw failure('git@gitlab.com: Permission denied (publickey).');
        await clonedInto(args);
        return { stdout: '' };
      });
      await cloneSourceRepository(root, 'https://gitlab.com/group/project', { run });
      expect(cloneArgs(run)).toStrictEqual(['git@gitlab.com:group/project.git', 'https://gitlab.com/group/project']);
    });

    it('reports a clear authentication error when both transports fail or git would prompt', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-auth-'));
      const run = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] !== 'clone') return { stdout: '' };
        throw failure(args[2]!.startsWith('git@') ? 'Host key verification failed.' : "fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled");
      });
      await expect(cloneSourceRepository(root, 'https://gitlab.com/group/project', { run })).rejects.toMatchObject({
        descriptor: { code: 'clone.authenticationFailed', params: { repository: 'project', host: 'gitlab.com' } },
      });
      expect(run.mock.calls.map(call => call[1][0] === 'clone' ? call[1][2] : call[1][0]).filter(value => value !== 'remote')).toStrictEqual(['git@gitlab.com:group/project.git', 'https://gitlab.com/group/project']);
    });

    it('recognises an authentication failure from the whole git message, not only its last lines', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-auth-full-'));
      const run = vi.fn(async (_command: string, args: string[]) => {
        if (args[0] !== 'clone') return { stdout: '' };
        throw failure('fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.');
      });
      await expect(cloneSourceRepository(root, 'git@gitea.example.com:team/app.git', { run })).rejects.toMatchObject({
        descriptor: { code: 'clone.authenticationFailed', params: { repository: 'app', host: 'gitea.example.com' } },
      });
    });

    it('reports the git error for other failures', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-failed-'));
      const run = vi.fn(async (_command: string, args: string[]) => { if (args[0] === 'clone') throw failure('fatal: repository not found'); return { stdout: '' }; });
      await expect(cloneSourceRepository(root, 'https://example.com/group/project.git', { run })).rejects.toMatchObject({
        descriptor: { code: 'clone.failed', params: { repository: 'project', detail: 'fatal: repository not found' } },
      });
    });

    it('keeps an explicit SSH URL on SSH and clones other hosts unchanged without prompts', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'app-clone-explicit-'));
      const run = vi.fn(async (_command: string, args: string[]) => { if (args[0] === 'clone') await clonedInto(args); return { stdout: '' }; });
      await cloneSourceRepository(root, 'git@github.com:nbonamy/one.git', { run });
      await cloneSourceRepository(root, 'https://example.com/team/two.git', { run });
      await cloneSourceRepository(root, 'https://user:token@gitlab.com/group/three.git', { run });
      expect(cloneArgs(run)).toStrictEqual(['git@github.com:nbonamy/one.git', 'https://example.com/team/two.git', 'https://user:token@gitlab.com/group/three.git']);
    });
  });

  it('normalizes a relative source folder before cloning and discovery', async () => {
    const sourceRootPath = await mkdtemp(path.join(process.cwd(), '.app-clone-relative-'));
    const sourceRoot = path.relative(process.cwd(), sourceRootPath);
    const run = vi.fn(async (_command: string, args: string[], options: { cwd: string }) => {
      if (args[0] === 'clone') {
        const destination = path.resolve(options.cwd, args.at(-1)!);
        await mkdir(path.join(destination, '.git'), { recursive: true });
        await writeFile(path.join(destination, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      }
      return { stdout: '' };
    });

    try {
      await expect(cloneSourceRepository(
        sourceRoot,
        'https://github.com/openai/skills.git',
        { run },
      )).resolves.toStrictEqual({
        name: 'skills',
        path: path.join(sourceRootPath, 'skills'),
        worktrees: [{ name: 'main', path: path.join(sourceRootPath, 'skills') }],
      });
    } finally {
      await rm(sourceRootPath, { recursive: true, force: true });
    }
  });

  it('reuses an existing clone only when its origin matches', async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'app-clone-existing-'));
    const destination = path.join(sourceRoot, 'agent-workspace');
    await mkdir(path.join(destination, '.git'), { recursive: true });
    await writeFile(path.join(destination, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const run = vi.fn().mockResolvedValue({ stdout: 'https://github.com/nbonamy/agent-workspace.git\n' });

    await expect(cloneSourceRepository(
      sourceRoot,
      'https://github.com/nbonamy/agent-workspace',
      { run },
    )).resolves.toMatchObject({ name: 'agent-workspace', path: destination });
    expect(run).toHaveBeenCalledOnce();
  });
});
