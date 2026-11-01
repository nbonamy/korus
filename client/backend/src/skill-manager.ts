import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { agentBackends } from '@workspace/core/contracts/shared';
import { curatedSkills, type InstalledSkill, type SkillManagerState, type SkillDocument, type SkillProviderLocation } from '@workspace/core/skill-manager';
import { backendHomeDir } from './state';
import { downloadSkills } from './skill-source';
import { discoverSkills } from './skill-discovery';

const name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
// Discovered skills are identified by whatever title their front matter gives them ("Commit-Push (cp)"), so a lookup key cannot be a slug.
const skillRef = z.string().trim().min(1).max(200);
const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('sync'), name: skillRef.optional() }).strict(),
  z.object({ action: z.literal('install'), source: z.string().trim().min(1).max(4096), backends: z.array(z.enum(agentBackends)).min(1).optional(), refresh: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('view'), name: skillRef }).strict(),
  z.object({ action: z.literal('remove'), name: skillRef.optional(), names: z.array(skillRef).min(1).max(200).optional(), confirmed: z.literal(true) }).strict(),
]);
const record = z.object({ name, description: z.string(), source: z.url(), revision: z.string().regex(/^[a-f0-9]{40}$/), collection: z.string().optional(), collectionSize: z.number().int().positive().optional(), links: z.array(z.string()).optional() });
const receipt = '.managed-skill.json';
const withoutRevision = (source: string) => source.replace(/\/tree\/[a-f0-9]{40}(\/|$)/, '/tree/*$1');

/** Owns managed skill content. Provider homes receive links, never replacement directories. */
export class SkillManager {
  private busy = false;
  constructor(private readonly locations: () => SkillProviderLocation[], private readonly root = path.join(backendHomeDir(), 'skills')) {}

  async manage(input: unknown): Promise<SkillManagerState> {
    const action = request.parse(input);
    if (this.busy) throw new Error('A skill operation is already running.');
    this.busy = true;
    try {
      const issues: string[] = [];
      let installedNames: Set<string> | undefined;
      if (action.action === 'install') {
        const skills = await downloadSkills(action.source);
        installedNames = new Set(skills.map(skill => skill.name));
        const collection = curatedSkills.find(entry => entry.kind === 'pack' && entry.source === action.source);
        const existing = await this.records();
        for (const skill of skills) {
          const current = existing.find(value => value.name === skill.name);
          // A refresh pulls the same skill again, so a newer revision of the same folder is expected.
          if (current && (action.refresh ? withoutRevision(current.source) !== withoutRevision(skill.source) : current.source !== skill.source)) throw new Error(`A different ${skill.name} skill is already installed. Remove it before installing another source or revision.`);
        }
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const stage = await mkdtemp(path.join(this.root, '.install-'));
        try {
          for (const skill of skills) {
            const current = existing.find(value => value.name === skill.name);
            if (current && !action.refresh) {
              if (collection && !current.collection) await writeFile(path.join(this.root, skill.name, receipt), JSON.stringify({ ...current, collection: collection.name, collectionSize: skills.length }), { mode: 0o600 });
              continue;
            }
            const destination = path.join(stage, skill.name);
            await mkdir(destination);
            for (const [file, { bytes, mode }] of skill.files) {
              const target = path.join(destination, file);
              await mkdir(path.dirname(target), { recursive: true });
              await writeFile(target, bytes, { flag: 'wx', mode });
            }
            await writeFile(path.join(destination, receipt), JSON.stringify(record.parse({ ...skill, ...(current?.links ? { links: current.links } : {}), ...(collection ? { collection: collection.name, collectionSize: skills.length } : {}) })), { flag: 'wx', mode: 0o600 });
          }
          for (const skill of skills) {
            const target = path.join(this.root, skill.name);
            if (!existing.some(value => value.name === skill.name)) { await rename(path.join(stage, skill.name), target); continue; }
            if (!action.refresh) continue;
            // Swap in the new copy; the links in each agent keep pointing at the same folder.
            const previous = path.join(stage, `.previous-${skill.name}`);
            await rename(target, previous);
            try { await rename(path.join(stage, skill.name), target); }
            catch (error) { await rename(previous, target); throw error; }
          }
          // What a curated pack installed, so uninstalling it removes exactly those skills.
          if (collection) await this.recordPack(collection.name, action.source, skills.map(skill => skill.name));
        } finally { await rm(stage, { recursive: true, force: true }); }
      }
      const discoveryLocations = this.locations(), locations = discoveryLocations.filter(location => !location.discoveryOnly), records = await this.records();
      let document: SkillDocument | undefined;
      if (action.action === 'view' || action.action === 'remove') {
        // A batch removal (a whole pack) skips names that are already gone; a single name must exist.
        const wanted = new Set(action.action === 'remove' ? action.names ?? (action.name ? [action.name] : []) : [action.name]);
        if (!wanted.size) throw new Error('A skill name is required.');
        const found = (await discoverSkills(discoveryLocations, issues)).filter(skill => wanted.has(skill.name));
        const managedRecords = records.filter(skill => wanted.has(skill.name));
        const missingNames = [...wanted].filter(wantedName => !found.some(skill => skill.name === wantedName) && !managedRecords.some(skill => skill.name === wantedName));
        if (action.action === 'remove' && action.names ? missingNames.length === wanted.size : missingNames.length) throw new Error('Skill not found. Refresh the installed list and try again.');
        const managed = managedRecords[0];
        if (action.action === 'view') {
          document = { name: action.name, files: [] };
          const sources = [
            ...(managed ? [{ path: path.join(this.root, managed.name), backend: undefined }] : []),
            ...found,
          ];
          for (const source of sources) {
            const file = path.join(source.path, 'SKILL.md');
            if ((await stat(file)).size > 128 * 1024) throw new Error('Skill document exceeds the 128 KiB limit.');
            const content = await readFile(file, 'utf8');
            let version = document.files.find(value => value.content === content);
            if (!version) { version = { providers: [], content }; document.files.push(version); }
            if (source.backend && !version.providers.includes(source.backend)) version.providers.push(source.backend);
          }
        } else {
          if (found.some(skill => skill.builtIn)) throw new Error('System skills cannot be deleted.');
          if (issues.length) throw new Error(`Cannot safely delete all installations: ${issues.join(' ')}`);
          // Validate every location before deleting anything. A nested skill inside a linked
          // pack cannot be removed without mutating the external pack's source directory.
          const targets = new Map<string, boolean>();
          for (const skill of found) {
            const location = discoveryLocations.filter(location => inside(location.directory, skill.path)).sort((a, b) => b.directory.length - a.directory.length)[0];
            if (!location || !inside(await realpath(location.directory), await realpath(path.dirname(skill.path)))) throw new Error('This skill belongs to a linked pack. Remove it using the pack installer.');
            targets.set(skill.path, (await lstat(skill.path)).isSymbolicLink());
          }
          for (const record of managedRecords) for (const target of record.links ?? []) if (await this.linkState(target, record.name) === 'installed') targets.set(target, true);
          for (const [target, linked] of targets) {
            if (linked) await unlink(target);
            else await rm(target, { recursive: true });
          }
          for (const record of managedRecords) await rm(path.join(this.root, record.name), { recursive: true });
          await this.forgetPackSkills([...wanted]);
        }
      }
      // An install links only what it brought in, and only for the chosen agents; Sync is what links everything everywhere.
      const linkLocations = action.action === 'install' && action.backends ? locations.filter(location => action.backends!.includes(location.backend)) : locations;
      if (action.action === 'install' || action.action === 'sync') for (const skill of installedNames ? records.filter(value => installedNames!.has(value.name)) : action.action === 'sync' && action.name ? records.filter(value => value.name === action.name) : records) {
        for (const location of linkLocations) {
          const target = path.join(location.directory, skill.name);
          const state = await this.linkState(target, skill.name);
          if (state === 'conflict') issues.push(`${location.backend}: existing ${skill.name} was preserved. Remove or rename it, then sync again.`);
          else if (state === 'missing') {
            try {
              await mkdir(location.directory, { recursive: true });
              await symlink(path.resolve(this.root, skill.name), target, process.platform === 'win32' ? 'junction' : 'dir');
            } catch (error) { issues.push(`${location.backend}: ${error instanceof Error ? error.message : String(error)}`); }
          }
        }
        const links = [...new Set([...(skill.links ?? []), ...linkLocations.map(location => path.join(location.directory, skill.name))])];
        const file = path.join(this.root, skill.name, receipt), temporary = `${file}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ ...skill, links }), { mode: 0o600 });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
      }
      if (action.action === 'sync') await this.linkPersonalSkills(discoveryLocations, locations, action.name, records, issues);
      const skills: InstalledSkill[] = await Promise.all((await this.records()).map(async ({ links: _links, ...skill }) => ({ ...skill, managed: true,
        providers: await Promise.all(locations.map(async location => ({ backend: location.backend, path: path.join(location.directory, skill.name), status: await this.linkState(path.join(location.directory, skill.name), skill.name) }))),
      })));
      for (const found of await discoverSkills(discoveryLocations, issues)) {
        let skill = skills.find(value => value.name === found.name);
        if (!skill) {
          skill = { name: found.name, description: found.description, managed: false, builtIn: found.builtIn, ...(found.origin ? { origin: found.origin } : {}), providers: [] };
          skills.push(skill);
        } else {
          if (found.builtIn) skill.builtIn = true;
          if (found.origin && !skill.origin) skill.origin = found.origin;
        }
        if (!skill.providers.some(provider => provider.backend === found.backend && provider.path === found.path)) {
          skill.providers.push({ backend: found.backend, path: found.path, status: 'installed' });
        }
      }
      for (const skill of skills) for (const location of locations) {
        if (!skill.providers.some(provider => provider.backend === location.backend)) skill.providers.push({ backend: location.backend, path: path.join(location.directory, skill.name), status: 'missing' });
      }
      for (const skill of skills) skill.providers.sort((a, b) => locations.findIndex(location => location.backend === a.backend) - locations.findIndex(location => location.backend === b.backend));
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return { ...(document ? { document } : {}), skills, providers: [...new Set(locations.map(location => location.backend))], curated: curatedSkills, issues, installs: await this.packInstalls() };
    } finally { this.busy = false; }
  }

  /**
   * Makes skills the user wrote available to every configured agent that cannot see them yet, by linking
   * to the original folder. Bundled and app-synced skills belong to their owners and are never linked.
   */
  private async linkPersonalSkills(discovery: SkillProviderLocation[], locations: SkillProviderLocation[], only: string | undefined, records: { name: string }[], issues: string[]): Promise<void> {
    const managed = new Set(records.map(skill => skill.name));
    const groups = new Map<string, Awaited<ReturnType<typeof discoverSkills>>>();
    for (const found of await discoverSkills(discovery, [])) groups.set(found.name, [...groups.get(found.name) ?? [], found]);
    if (only && !managed.has(only) && !groups.has(only)) throw new Error('Skill not found. Refresh the installed list and try again.');
    for (const [skillName, copies] of groups) {
      if (managed.has(skillName) || (only && skillName !== only) || copies.some(copy => copy.builtIn || copy.origin === 'synced')) continue;
      const source = await realpath(copies[0]!.path);
      for (const location of locations) {
        const target = path.join(location.directory, path.basename(source));
        if (copies.some(copy => copy.backend === location.backend && (
          inside(location.directory, copy.path) ||
          discovery.some(origin => origin.backend === copy.backend && origin.discoveryOnly && inside(origin.directory, copy.path))
        ))) continue;
        if (await lstat(target).then(() => true, () => false)) { issues.push(`${location.backend}: existing ${path.basename(source)} was preserved. Remove or rename it, then sync again.`); continue; }
        try {
          await mkdir(location.directory, { recursive: true });
          await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) { issues.push(`${location.backend}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
  }

  private packFile() { return path.join(path.dirname(this.root), 'skill-installs.json'); }

  private async readPacks(): Promise<Record<string, { source: string; skills: string[] }>> {
    return readFile(this.packFile(), 'utf8').then(text => z.record(z.string(), z.object({ source: z.string(), skills: z.array(z.string()) })).parse(JSON.parse(text)), () => ({}));
  }

  /** The skills each curated pack installed through Korus, by pack name. */
  private async packInstalls(): Promise<Record<string, string[]>> {
    return Object.fromEntries(Object.entries(await this.readPacks()).map(([pack, entry]) => [pack, entry.skills]));
  }

  private async writePacks(packs: Record<string, { source: string; skills: string[] }>) {
    await mkdir(path.dirname(this.packFile()), { recursive: true });
    const temporary = `${this.packFile()}.tmp`;
    await writeFile(temporary, JSON.stringify(packs, null, 2), { mode: 0o600 });
    await rename(temporary, this.packFile());
  }

  private async recordPack(pack: string, source: string, skills: string[]) {
    const packs = await this.readPacks();
    // A refresh can add skills; ones the repository dropped stay listed so uninstalling still removes them.
    packs[pack] = { source, skills: [...new Set([...(packs[pack]?.skills ?? []), ...skills])].sort() };
    await this.writePacks(packs);
  }

  private async forgetPackSkills(names: string[]) {
    const packs = await this.readPacks();
    let changed = false;
    for (const [pack, entry] of Object.entries(packs)) {
      const remaining = entry.skills.filter(skill => !names.includes(skill));
      if (remaining.length === entry.skills.length) continue;
      changed = true;
      if (remaining.length) packs[pack] = { ...entry, skills: remaining }; else delete packs[pack];
    }
    if (changed) await this.writePacks(packs);
  }

  private async records() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    return Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
      const skill = record.parse(JSON.parse(await readFile(path.join(this.root, entry.name, receipt), 'utf8')));
      if (entry.name !== skill.name) throw new Error('Invalid managed skill directory.');
      return skill;
    }));
  }

  private async linkState(target: string, skill: string): Promise<'installed' | 'missing' | 'conflict'> {
    const current = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!current) return 'missing';
    return current.isSymbolicLink() && path.resolve(path.dirname(target), await readlink(target)) === path.resolve(this.root, skill) ? 'installed' : 'conflict';
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
