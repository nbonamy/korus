import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppBackendServer } from '../server';
import { ProviderSetup } from '../provider-setup';
import { createRemoteAgent, createTestSnapshot } from './server-test-fixtures';
import { BackendDriverRpc } from '../driver-rpc';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import type { BackendPublishedEvent, BackendSkillSummary } from '@workspace/core/contracts';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { curatedSkills } from '@workspace/core/skill-manager';

let root: string;
const sha = 'a'.repeat(40);
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-skills-'));
  vi.stubEnv('APP_HOME', path.join(root, 'app'));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

function download(unsafe = false) {
  const files = new Map([
    ['skills/review/SKILL.md', '---\nname: example-review\ndescription: Review a change.\n---\nRead references/checks.md.\n'],
    ['skills/review/references/checks.md', 'Check behavior.\n'],
    ['skills/other/SKILL.md', '---\nname: another-skill\n---\nInstructions.\n'],
  ]);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/commits/')) return Response.json({ sha });
    if (url.includes('/git/trees/')) return Response.json({ tree: [...files].map(([file, data]) => ({ path: file, type: 'blob', mode: unsafe && file.endsWith('checks.md') ? '120000' : '100644', size: data.length })) });
    return new Response(files.get(decodeURIComponent(url.split(`/${sha}/`)[1]!)));
  }));
}

function downloadLargeSkillSet() {
  const files = new Map<string, string>([
    ['skills/custom-container/SKILL.md', '---\nname: requested-skill\ndescription: Selected by front matter.\n---\nInstructions.\n'],
  ]);
  for (let index = 0; index < 25; index++) {
    files.set(`skills/other-${index}/SKILL.md`, `---\nname: other-${index}\n---\nInstructions.\n`);
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/commits/')) return Response.json({ sha });
    if (url.includes('/git/trees/')) return Response.json({ tree: [...files].map(([file, data]) => ({ path: file, type: 'blob', mode: '100644', size: data.length })) });
    return new Response(files.get(decodeURIComponent(url.split(`/${sha}/`)[1]!)));
  }));
}

function host(options: { multiRootAntigravity?: boolean } = {}) {
  const installed = new Set(['codex', 'claude']);
  const snapshot = createTestSnapshot();
  snapshot.agents = [{ ...createRemoteAgent(), id: 'local-agent', teamId: 'team-test', folder: root }];
  let catalog: BackendSkillSummary[] = [];
  const driver: AgentBackendDriver = {
    backend: 'codex', getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
    getCapabilities: () => codexBackendCapabilities, sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(),
    onEvent: () => () => undefined, close: async () => undefined,
    async listSkills(_agent, forceReload = false) {
      if (forceReload) catalog = (await readdir(path.join(root, 'codex/skills')).catch(() => [])).map(name => ({ name, description: '', enabled: true, path: path.join(root, 'codex/skills', name, 'SKILL.md') }));
      return catalog;
    },
  };
  const events: BackendPublishedEvent[] = [];
  const lifecycles = new Map((['codex', 'claude', 'antigravity'] as const).map(backend => [backend, {
    home: () => ({ isolated: true, shareSkills: false, homePath: path.join(root, backend) }),
    installed: () => installed.has(backend), prepareHome: async () => {},
    skillDirectories: (home: { homePath: string }) => options.multiRootAntigravity && backend === 'antigravity'
      ? ['config', 'antigravity-cli'].map(directory => path.join(home.homePath, directory, 'skills'))
      : [path.join(home.homePath, 'skills')],
    skillDiscoveryDirectories: () => backend === 'codex' ? [path.join(root, 'shared/skills')] : [],
  }]));
  const setup = new ProviderSetup(snapshot, async () => {}, async () => {}, lifecycles);
  const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: setup, driverRpc: new BackendDriverRpc(new Map([['codex', driver]])), onBackendEventApplied: event => events.push(event) });
  let id = 0;
  const request = (input: object) => server.handleMessage({ jsonrpc: '2.0', id: ++id, method: 'settings/skills/manage', params: { input } });
  return { server, setup, installed, request, events };
}

it('installs a selected skill for all providers, restores its catalog, syncs a new provider and removes the selected skill across providers', async () => {
  await download();
  const { server, installed, request, events } = host();
  try {
    const result = await request({ action: 'install', source: 'npx skills add https://github.com/example/skills --skill example-review' });
    expect(result).toMatchObject({ result: { skills: [{ name: 'example-review', managed: true, revision: sha, providers: [
      { backend: 'codex', status: 'installed' }, { backend: 'claude', status: 'installed' },
    ] }] } });
    expect(events.filter(event => event.type === 'skills.changed').at(-1)).toMatchObject({ backend: 'codex', payload: { skills: [{ name: 'example-review' }] } });
    expect(await readFile(path.join(root, 'claude/skills/example-review/references/checks.md'), 'utf8')).toBe('Check behavior.\n');
    expect(await readdir(path.join(root, 'codex/skills'))).toStrictEqual(['example-review']);
    installed.add('antigravity');
    const restored = host(); restored.installed.add('antigravity');
    try {
      expect(await restored.request({ action: 'list' })).toMatchObject({ result: { skills: [{ name: 'example-review' }] } });
      await mkdir(path.join(root, 'antigravity/skills/example-review'), { recursive: true });
      await writeFile(path.join(root, 'antigravity/skills/example-review/SKILL.md'), 'Personal skill');
      expect(await request({ action: 'sync' })).toMatchObject({ result: { skills: [{ providers: [
        { status: 'installed' }, { status: 'installed' }, { backend: 'antigravity', status: 'conflict' },
      ] }] } });
      expect(await readFile(path.join(root, 'antigravity/skills/example-review/SKILL.md'), 'utf8')).toBe('Personal skill');
      await rm(path.join(root, 'antigravity/skills/example-review'), { recursive: true });
      expect(await request({ action: 'sync' })).toMatchObject({ result: { skills: [{ providers: [
        { status: 'installed' }, { status: 'installed' }, { status: 'installed' },
      ] }] } });
      await request({ action: 'install', source: 'https://github.com/example/skills/tree/main/skills/review' });
      expect(await request({ action: 'list' })).toMatchObject({ result: { skills: [{ name: 'example-review' }] } });
      await rm(path.join(root, 'claude/skills/example-review'));
      await mkdir(path.join(root, 'claude/skills/example-review'));
      await writeFile(path.join(root, 'claude/skills/example-review/SKILL.md'), 'Replacement personal skill');
      const viewed = await request({ action: 'view', name: 'example-review' });
      expect(viewed).toMatchObject({ result: { document: { name: 'example-review', files: expect.arrayContaining([expect.objectContaining({ content: 'Replacement personal skill' })]) } } });
      await expect(request({ action: 'remove', name: 'example-review' })).rejects.toThrow();
      await request({ action: 'remove', name: 'example-review', confirmed: true });
      await expect(readFile(path.join(root, 'claude/skills/example-review/SKILL.md'), 'utf8')).rejects.toThrow();
      expect(await readdir(path.join(root, 'codex/skills'))).toStrictEqual([]);
      expect(events.filter(event => event.type === 'skills.changed').at(-1)).toMatchObject({ payload: { skills: [] } });
      expect(await request({ action: 'list' })).toMatchObject({ result: { skills: [] } });
      const pack = curatedSkills.find(entry => entry.name === 'matt-pocock')!;
      expect(await request({ action: 'install', source: pack.source })).toMatchObject({ result: { skills: [
        { name: 'another-skill', collection: 'matt-pocock', collectionSize: 2 },
        { name: 'example-review', collection: 'matt-pocock', collectionSize: 2 },
      ] } });
      await expect(request({ action: 'install', source: curatedSkills.find(entry => entry.name === 'pstack')!.source })).rejects.toThrow('already installed');
      expect(await readFile(path.join(root, 'codex/skills/example-review/SKILL.md'), 'utf8')).toContain('name: example-review');
    } finally { await restored.server.close(); }
  } finally { await server.close(); }
});

it('selects a skill by front matter name in a large repository when its folder name differs', async () => {
  downloadLargeSkillSet();
  const { server, request } = host();
  try {
    const result = await request({ action: 'install', source: 'npx skills add https://github.com/example/skills --skill requested-skill' });
    expect(result).toMatchObject({ result: { skills: [{ name: 'requested-skill', managed: true }] } });
    expect(await readdir(path.join(root, 'app/skills'))).toStrictEqual(['requested-skill']);
  } finally { await server.close(); }
});

it('installs only for the selected coding agents and leaves other agents alone until a sync', async () => {
  await download();
  const { server, request } = host();
  try {
    const result = await request({ action: 'install', source: 'https://github.com/example/skills/tree/main/skills/review', backends: ['claude'] });
    expect(result).toMatchObject({ result: { skills: [{ name: 'example-review', providers: [
      { backend: 'codex', status: 'missing' }, { backend: 'claude', status: 'installed' },
    ] }] } });
    expect(await readdir(path.join(root, 'codex/skills')).catch(() => [])).toStrictEqual([]);
    expect(await readdir(path.join(root, 'claude/skills'))).toStrictEqual(['example-review']);
    // A later install for everyone must not widen what an earlier one limited.
    await request({ action: 'install', source: 'https://github.com/example/skills/tree/main/skills/other' });
    expect(await readdir(path.join(root, 'codex/skills')).catch(() => [])).not.toContain('example-review');
    const synced = await request({ action: 'sync' }) as { result: { skills: { name: string; providers: { status: string }[] }[] } };
    expect(synced.result.skills.find(skill => skill.name === 'example-review')!.providers.map(provider => provider.status)).toEqual(['installed', 'installed']);
    await expect(request({ action: 'install', source: 'https://github.com/example/skills/tree/main/skills/review', backends: [] })).rejects.toThrow();
  } finally { await server.close(); }
});

it('views and removes a skill whose front matter title is not a slug', async () => {
  await mkdir(path.join(root, 'claude/skills/commit-push'), { recursive: true });
  await writeFile(path.join(root, 'claude/skills/commit-push/SKILL.md'), '---\nname: Commit-Push (cp)\ndescription: Commit safely.\n---\nBody.\n');
  const { server, request } = host();
  try {
    expect(await request({ action: 'list' })).toMatchObject({ result: { skills: [{ name: 'Commit-Push (cp)' }] } });
    expect(await request({ action: 'view', name: 'Commit-Push (cp)' })).toMatchObject({ result: { document: { files: [{ content: expect.stringContaining('Body.') }] } } });
    await request({ action: 'remove', name: 'Commit-Push (cp)', confirmed: true });
    await expect(readFile(path.join(root, 'claude/skills/commit-push/SKILL.md'), 'utf8')).rejects.toThrow();
  } finally { await server.close(); }
});

it('syncs personal skills to the agents that cannot see them, one skill or all, leaving bundled skills and existing folders alone', async () => {
  const skill = async (folder: string, name: string) => {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}.\n---\nBody.\n`);
  };
  await skill('codex/skills/codex-only', 'codex-only');
  await skill('shared/skills/shared-one', 'shared-one');
  await skill('codex/skills/.system/bundled', 'bundled');
  await skill('codex/skills/taken', 'taken');
  await mkdir(path.join(root, 'claude/skills/taken'), { recursive: true });
  await writeFile(path.join(root, 'claude/skills/taken/notes.txt'), 'Not a skill, but in the way');
  const { server, request } = host();
  try {
    await request({ action: 'sync', name: 'codex-only' });
    expect(await readFile(path.join(root, 'claude/skills/codex-only/SKILL.md'), 'utf8')).toContain('name: codex-only');
    expect(await readdir(path.join(root, 'claude/skills'))).not.toContain('shared-one');
    const all = await request({ action: 'sync' }) as { result: { issues: string[] } };
    expect(await readFile(path.join(root, 'claude/skills/shared-one/SKILL.md'), 'utf8')).toContain('name: shared-one');
    expect(await readdir(path.join(root, 'claude/skills'))).not.toContain('bundled');
    expect(await readFile(path.join(root, 'claude/skills/taken/notes.txt'), 'utf8')).toBe('Not a skill, but in the way');
    expect(all.result.issues.join('\n')).toContain('existing taken was preserved');
    await expect(request({ action: 'sync', name: 'no-such-skill' })).rejects.toThrow('Skill not found');
  } finally { await server.close(); }
});

it('syncs a personal skill into a second configured root for the same provider', async () => {
  const { server, installed, request } = host({ multiRootAntigravity: true });
  installed.add('antigravity');
  const content = '---\nname: personal-notes\ndescription: Personal notes.\n---\nInstructions.\n';
  const source = path.join(root, 'antigravity/config/skills/personal-notes/SKILL.md');
  const target = path.join(root, 'antigravity/antigravity-cli/skills/personal-notes/SKILL.md');
  try {
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, content);
    await request({ action: 'sync', name: 'personal-notes' });
    expect(await readFile(target, 'utf8')).toBe(content);
  } finally { await server.close(); }
});

it('removes several skills in one request, skipping the ones already gone and refusing system skills', async () => {
  const skill = async (folder: string, name: string) => {
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}.\n---\nBody.\n`);
  };
  for (const name of ['one', 'two', 'three']) await skill(`codex/skills/${name}`, name);
  await skill('codex/skills/.system/bundled', 'bundled');
  const { server, request } = host();
  try {
    await request({ action: 'remove', names: ['one', 'two', 'already-gone'], confirmed: true });
    expect((await readdir(path.join(root, 'codex/skills'))).sort()).toEqual(['.system', 'three']);
    await expect(request({ action: 'remove', names: ['three', 'bundled'], confirmed: true })).rejects.toThrow('System skills cannot be deleted');
    expect(await readdir(path.join(root, 'codex/skills'))).toContain('three');
    await expect(request({ action: 'remove', names: ['nothing', 'nope'], confirmed: true })).rejects.toThrow('Skill not found');
    await expect(request({ action: 'remove', confirmed: true })).rejects.toThrow();
  } finally { await server.close(); }
});

it('records what a pack installed, refreshes it from the repository and uninstalls exactly those skills', async () => {
  const remote = (revision: string, files: Record<string, string>) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/commits/')) return Response.json({ sha: revision });
    if (url.includes('/git/trees/')) return Response.json({ tree: Object.entries(files).map(([file, data]) => ({ path: file, type: 'blob', mode: '100644', size: data.length })) });
    return new Response(files[decodeURIComponent(url.split(`/${revision}/`)[1]!)]);
  }));
  const skill = (name: string, body: string) => `---\nname: ${name}\ndescription: ${name}.\n---\n${body}\n`;
  const pack = curatedSkills.find(entry => entry.name === 'matt-pocock')!;
  remote('a'.repeat(40), { 'skills/one/SKILL.md': skill('one', 'First version'), 'skills/two/SKILL.md': skill('two', 'Two') });
  const { server, request } = host();
  try {
    expect(await request({ action: 'install', source: pack.source })).toMatchObject({ result: { installs: { 'matt-pocock': ['one', 'two'] } } });
    expect(await readFile(path.join(root, 'codex/skills/one/SKILL.md'), 'utf8')).toContain('First version');

    // Refresh pulls the pack again: changed skills are replaced in place, new ones arrive, links stay valid.
    remote('b'.repeat(40), { 'skills/one/SKILL.md': skill('one', 'Second version'), 'skills/two/SKILL.md': skill('two', 'Two'), 'skills/three/SKILL.md': skill('three', 'Three') });
    await expect(request({ action: 'install', source: pack.source })).rejects.toThrow('already installed');
    expect(await readFile(path.join(root, 'claude/skills/one/SKILL.md'), 'utf8')).toContain('First version');
    const refreshed = await request({ action: 'install', source: pack.source, refresh: true });
    expect(refreshed).toMatchObject({ result: { installs: { 'matt-pocock': ['one', 'three', 'two'] } } });
    expect(await readFile(path.join(root, 'claude/skills/one/SKILL.md'), 'utf8')).toContain('Second version');
    expect(await readFile(path.join(root, 'codex/skills/three/SKILL.md'), 'utf8')).toContain('Three');

    // A skill installed on its own is not part of any pack, and uninstalling a pack removes only its skills.
    remote('c'.repeat(40), { 'skills/solo/SKILL.md': skill('solo', 'Solo') });
    await request({ action: 'install', source: 'https://github.com/example/solo/tree/main/skills/solo' });
    const removed = await request({ action: 'remove', names: ['one', 'three', 'two'], confirmed: true });
    expect(removed).toMatchObject({ result: { skills: [{ name: 'solo' }] } });
    expect((removed as { result: { installs?: object } }).result.installs).toEqual({});
    expect(await readdir(path.join(root, 'codex/skills'))).toStrictEqual(['solo']);
  } finally { await server.close(); }
});

it('rejects unsafe sources and repository links without writing provider skills', async () => {
  const { server, request } = host();
  try {
    for (const input of [{ action: 'install', source: 'https://github.com.evil.test/example/skills' }, { action: 'remove', name: '../outside' }, { action: 'sync', unexpected: true }]) {
      await expect(request(input)).rejects.toThrow();
    }
    await download(true);
    await expect(request({ action: 'install', source: 'https://github.com/example/skills' })).rejects.toThrow('symbolic link');
    expect(await readdir(path.join(root, 'app/skills')).catch(() => [])).toStrictEqual([]);
  } finally { await server.close(); }
});


it('discovers native skills, views their distinct contents and deletes installations without following linked sources', async () => {
  const paths = ['codex/skills/ask-matt', 'claude/skills/ask-matt', 'codex/skills/.system/bundled-tool', 'claude/skills/bundled-tool', 'shared/browser', 'shared/skills/global-only'];
  for (const folder of paths) {
    await mkdir(path.join(root, folder), { recursive: true });
    const skillName = folder.endsWith('global-only') ? 'global-only' : folder.endsWith('ask-matt') ? 'ask-matt' : folder.endsWith('browser') ? 'chrome-browser' : 'bundled-tool';
    await writeFile(path.join(root, folder, 'SKILL.md'), `---\nname: ${skillName}\ndescription: >\n  A useful skill\n  already installed.\n---\nInstructions.\n`);
  }
  await symlink(path.join(root, 'codex/skills/.system/bundled-tool'), path.join(root, 'claude/skills/system-alias'), 'dir');
  await symlink(path.join(root, 'shared/browser'), path.join(root, 'claude/skills/browser-link'), 'dir');
  await symlink(path.join(root, 'codex/skills'), path.join(root, 'codex/skills/cycle'), 'dir');
  const { server, request } = host();
  try {
    const listed = await request({ action: 'list' });
    expect(listed).toMatchObject({ result: { skills: [
      { name: 'ask-matt', managed: false, description: 'A useful skill already installed.', providers: [{ backend: 'codex', status: 'installed' }, { backend: 'claude', status: 'installed' }] },
      { name: 'bundled-tool', managed: false, builtIn: true, providers: [{ backend: 'codex', status: 'installed' }, { backend: 'claude', status: 'installed' }, { backend: 'claude', status: 'installed' }] },
      { name: 'chrome-browser', managed: false, providers: [{ backend: 'codex', status: 'missing' }, { backend: 'claude', status: 'installed', path: path.join(root, 'claude/skills/browser-link') }] },
      { name: 'global-only', managed: false, providers: [{ backend: 'codex', status: 'installed' }, { backend: 'claude', status: 'missing' }] },
    ] } });
    expect(await request({ action: 'view', name: 'chrome-browser' })).toMatchObject({ result: { document: { name: 'chrome-browser', files: [{ content: expect.stringContaining('name: chrome-browser'), providers: ['claude'] }] } } });
    await request({ action: 'sync' });
    expect(await readFile(path.join(root, 'claude/skills/ask-matt/SKILL.md'), 'utf8')).toContain('name: ask-matt');
    expect(await readdir(path.join(root, 'app/skills')).catch(() => [])).toStrictEqual([]);
    expect(await readdir(path.join(root, 'codex/skills'))).not.toContain('chrome-browser');
    expect(await readdir(path.join(root, 'codex/skills'))).not.toContain('global-only');
    await expect(request({ action: 'remove', name: 'bundled-tool', confirmed: true })).rejects.toThrow('System skills cannot be deleted');
    expect(await readFile(path.join(root, 'codex/skills/.system/bundled-tool/SKILL.md'), 'utf8')).toContain('name: bundled-tool');
    expect(await readFile(path.join(root, 'claude/skills/bundled-tool/SKILL.md'), 'utf8')).toContain('name: bundled-tool');
    await request({ action: 'remove', name: 'ask-matt', confirmed: true });
    expect(await request({ action: 'list' })).not.toMatchObject({ result: { skills: expect.arrayContaining([expect.objectContaining({ name: 'ask-matt' })]) } });
    await expect(readFile(path.join(root, 'claude/skills/ask-matt/SKILL.md'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(root, 'codex/skills/ask-matt/SKILL.md'), 'utf8')).rejects.toThrow();
    await request({ action: 'remove', name: 'chrome-browser', confirmed: true });
    expect(await readdir(path.join(root, 'claude/skills'))).not.toContain('browser-link');
    expect(await readFile(path.join(root, 'shared/browser/SKILL.md'), 'utf8')).toContain('name: chrome-browser');
    await request({ action: 'remove', name: 'global-only', confirmed: true });
    expect(await readdir(path.join(root, 'shared/skills'))).toStrictEqual([]);
    const pack = path.join(root, 'external-pack');
    await mkdir(path.join(pack, 'nested'), { recursive: true });
    await writeFile(path.join(pack, 'nested/SKILL.md'), '---\nname: nested\n---\nKeep this source.');
    await symlink(pack, path.join(root, 'claude/skills/linked-pack'), 'dir');
    await expect(request({ action: 'remove', name: 'nested', confirmed: true })).rejects.toThrow('linked pack');
    expect(await readFile(path.join(pack, 'nested/SKILL.md'), 'utf8')).toContain('Keep this source.');

  } finally { await server.close(); }
});
