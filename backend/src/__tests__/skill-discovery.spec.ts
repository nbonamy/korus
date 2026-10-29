import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { discoverSkills } from '../skill-discovery';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'korus-discovery-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function skill(folder: string, name: string) {
  await mkdir(path.join(root, folder, name), { recursive: true });
  await writeFile(path.join(root, folder, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill.\n---\nBody.\n`);
}
const find = async () => discoverSkills([{ backend: 'claude', directory: root }], []);

it('skips the trash and other hidden folders but still finds system skills', async () => {
  await skill('mine', 'notes');
  await skill('.trash/17910-abc', 'deleted');
  await skill('.cache', 'cached');
  await skill('.system', 'imagegen');
  const found = await find();
  expect(found.map(value => value.name).sort()).toEqual(['imagegen', 'notes']);
  expect(found.find(value => value.name === 'imagegen')!.builtIn).toBe(true);
});

it('treats skills the Claude app syncs in as built-in and other synced skills as synced', async () => {
  await skill('synced/session-1', 'built-in-browser');
  await skill('synced/session-1', 'handmade');
  await writeFile(path.join(root, 'synced/session-1/manifest.json'), JSON.stringify({ skills: [{ name: 'built-in-browser', source: 'anthropic' }, { name: 'handmade', source: 'someone-else' }] }));
  await skill('synced/no-manifest', 'orphan');
  await skill('plain', 'notes');
  const kinds = Object.fromEntries((await find()).map(value => [value.name, { builtIn: value.builtIn, origin: value.origin }]));
  expect(kinds).toEqual({
    'built-in-browser': { builtIn: true, origin: undefined },
    handmade: { builtIn: false, origin: 'synced' },
    orphan: { builtIn: false, origin: 'synced' },
    notes: { builtIn: false, origin: undefined },
  });
});
