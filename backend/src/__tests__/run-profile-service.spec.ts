import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunProfileService } from '../run-profile-service';

const exec = promisify(execFile);
let root: string;
let repo: string;
let worktree: string;
let service: RunProfileService;
const agent = 'agent-one';
const profile = { name: 'Dev server', command: 'node server.cjs', directory: '.' };
const waitFor = async (read: () => Promise<boolean>) => {
  const until = Date.now() + 8000;
  while (!await read()) {
    if (Date.now() > until) throw new Error('Timed out waiting for profile process');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'korus-profile-test-')));
  repo = path.join(root, 'repo');
  worktree = path.join(root, 'linked');
  await mkdir(repo);
  await exec('git', ['init', repo]);
  await exec('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--allow-empty', '-m', 'fixture']);
  await exec('git', ['-C', repo, 'worktree', 'add', '-b', 'fixture', worktree]);
  service = new RunProfileService(path.join(root, 'home', 'run-profiles.json'));
});
afterEach(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });

describe('repository run profiles', () => {
  it('shares a private user-created catalog across worktrees and survives restart without runs', async () => {
    const saved = await service.save(agent, repo, { ...profile, command: 'node -e "console.log(42)"' });
    const linked = await service.get(agent, worktree);
    expect(linked).toStrictEqual({ ...saved, worktree, targets: { [saved.profiles[0].id]: { cwd: worktree } }, runs: [] });
    await service.close();
    service = new RunProfileService(path.join(root, 'home', 'run-profiles.json'));
    expect(await service.get(agent, worktree)).toStrictEqual(linked);
    await service.delete(agent, worktree, saved.profiles[0].id);
    expect((await service.get(agent, repo)).profiles).toStrictEqual([]);
  });

  it('rejects traversal, absolute paths, symlink escapes and secret environment configuration', async () => {
    await symlink(root, path.join(repo, 'outside'));
    for (const directory of ['../', root, 'outside']) {
      await expect(service.save(agent, repo, { ...profile, directory })).rejects.toThrow(/inside|relative/);
    }
    await expect(service.save(agent, repo, { ...profile, env: { TOKEN: 'private' } } as never)).rejects.toThrow();
    await expect(service.save(agent, repo, { ...profile, command: 'TOKEN=private npm run dev' })).rejects.toThrow(/environment/);
    await expect(service.save(agent, repo, { ...profile, previewUrl: 'https://example.com' })).rejects.toThrow(/loopback/);
    expect((await service.get(agent, repo)).profiles).toStrictEqual([]);
  });

  it('revalidates a saved directory after a symlink is replaced and never starts it', async () => {
    await mkdir(path.join(repo, 'app'));
    const saved = await service.save(agent, repo, { ...profile, directory: 'app' });
    await rm(path.join(repo, 'app'), { recursive: true });
    await symlink(root, path.join(repo, 'app'));
    const p = saved.profiles[0];
    await expect(service.start(agent, repo, { profileId: p.id, command: p.command, cwd: path.join(repo, 'app') })).rejects.toThrow(/inside/);
    expect((await service.get(agent, repo)).runs).toStrictEqual([]);
    expect((await service.get(agent, repo)).targets[p.id].error).toMatch(/inside/);
  });

  it('requires the reviewed command and target, records failures, and isolates stop/output by agent', async () => {
    const catalog = await service.save(agent, repo, { ...profile, command: 'node -e "console.error(\'bad start\');process.exit(7)"' });
    const p = catalog.profiles[0];
    await expect(service.start(agent, repo, { profileId: p.id, command: 'different', cwd: repo })).rejects.toThrow(/changed/);
    await expect(service.start(agent, repo, { profileId: p.id, command: p.command, cwd: worktree })).rejects.toThrow(/changed/);
    const run = await service.start(agent, repo, { profileId: p.id, command: p.command, cwd: repo });
    await waitFor(async () => (await service.get(agent, repo)).runs[0].state === 'failed');
    expect((await service.get(agent, repo)).runs[0]).toMatchObject({ id: run.id, state: 'failed', exitCode: 7, output: expect.stringContaining('bad start') });
    expect((await service.get('another', repo)).runs).toStrictEqual([]);
    await expect(service.stop('another', run.id)).rejects.toThrow(/not found/);
  });

  it('runs an isolated dev server in the selected worktree, previews it, and stops its owned descendants', async () => {
    await writeFile(path.join(worktree, 'server.cjs'), `const http=require('node:http');const s=http.createServer((q,r)=>r.end('isolated worktree'));s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port));`);
    const catalog = await service.save(agent, repo, profile);
    const p = catalog.profiles[0];
    const run = await service.start(agent, worktree, { profileId: p.id, command: p.command, cwd: worktree });
    await expect(service.start(agent, worktree, { profileId: p.id, command: p.command, cwd: worktree })).rejects.toThrow(/already running/);
    let url = '';
    await waitFor(async () => { url = (await service.get(agent, worktree)).runs[0].output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? ''; return Boolean(url); });
    expect(await (await fetch(url)).text()).toBe('isolated worktree');
    expect(await service.stop(agent, run.id)).toMatchObject({ state: 'stopped', cwd: worktree });
    await expect(fetch(url)).rejects.toThrow();
    expect((await service.get(agent, repo)).runs).toStrictEqual([]);
  });

  it('redacts inherited credentials even when output arrives in separate chunks', async () => {
    process.env.KORUS_PROFILE_TEST_TOKEN = 'fixture-private-secret';
    try {
      const catalog = await service.save(agent, repo, { ...profile, command: `node -e "process.stdout.write(process.env.KORUS_PROFILE_TEST_TOKEN.slice(0,8));setTimeout(()=>console.log(process.env.KORUS_PROFILE_TEST_TOKEN.slice(8)),80)"` });
      const p = catalog.profiles[0];
      await service.start(agent, repo, { profileId: p.id, command: p.command, cwd: repo });
      await waitFor(async () => (await service.get(agent, repo)).runs[0].state === 'completed');
      expect((await service.get(agent, repo)).runs[0].output).toBe('[redacted]\n');
    } finally { delete process.env.KORUS_PROFILE_TEST_TOKEN; }
  });

  it('bounds volatile output, redacts inherited secrets, and cleans up on owner removal/shutdown', async () => {
    process.env.KORUS_PROFILE_TEST_TOKEN = 'fixture-private-secret';
    try {
      const catalog = await service.save(agent, repo, { ...profile, command: 'node -e "console.log(process.env.KORUS_PROFILE_TEST_TOKEN);console.log(\'x\'.repeat(100000));setInterval(()=>{},1000)"' });
      const p = catalog.profiles[0];
      const run = await service.start(agent, repo, { profileId: p.id, command: p.command, cwd: repo });
      await waitFor(async () => (await service.get(agent, repo)).runs[0].outputTruncated);
      const result = (await service.get(agent, repo)).runs[0];
      expect(result.output.length).toBeLessThanOrEqual(65536);
      expect(result.output).not.toContain('fixture-private-secret');
      expect(await readFile(path.join(root, 'home', 'run-profiles.json'), 'utf8')).not.toContain('fixture-private-secret');
      await service.stopAgent(agent);
      expect((await service.get(agent, repo)).runs[0]).toMatchObject({ id: run.id, state: 'stopped' });
      await service.close();
      await expect(service.start(agent, repo, { profileId: p.id, command: p.command, cwd: repo })).rejects.toThrow(/closed/);
    } finally { delete process.env.KORUS_PROFILE_TEST_TOKEN; }
  });
});
