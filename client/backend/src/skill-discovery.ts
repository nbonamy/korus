import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SkillProviderLocation } from '@workspace/core/skill-manager';
import { skillMetadata } from './skill-metadata';

type SkillOrigin = 'synced';
export type DiscoveredSkill = { name: string; description: string; backend: SkillProviderLocation['backend']; path: string; builtIn: boolean; origin?: SkillOrigin };

/** Discover native skills without modifying their instructions or linked sources. */
export async function discoverSkills(locations: SkillProviderLocation[], issues: string[]): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];
  for (const location of locations) {
    const visited = new Set<string>();
    async function visit(folder: string, depth: number): Promise<void> {
      const canonical = await realpath(folder);
      if (visited.has(canonical)) return;
      if (depth > 8 || visited.size >= 2000) throw new Error('The skill directory exceeds the discovery limit.');
      visited.add(canonical);
      if (depth) {
        const file = path.join(folder, 'SKILL.md');
        const info = await stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; });
        if (info?.isFile()) {
          if (info.size > 128 * 1024) throw new Error(`Skill metadata is too large: ${file}`);
          const metadata = skillMetadata(await readFile(file, 'utf8'), path.basename(folder));
          const synced = await syncedSource(folder, metadata.name);
          // Skills bundled with an app are built-in whether they ship in `.system` or arrive through the Claude app's sync.
          const builtIn = synced === 'anthropic' || [folder, canonical, await realpath(file)].some(value => value.split(path.sep).includes('.system'));
          skills.push({ ...metadata, backend: location.backend, path: folder, builtIn, ...(synced === 'other' ? { origin: 'synced' as const } : {}) });
          return;
        }
      }
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (visited.size >= 2000) { issues.push(`${location.backend}: some skills were omitted because the directory exceeds the discovery limit.`); break; }
        // Hidden folders (trash, caches) are not installed skills; only `.system` holds bundled ones.
        if (entry.name === '.git' || entry.name === 'node_modules' || (entry.name.startsWith('.') && entry.name !== '.system') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
        try { await visit(path.join(folder, entry.name), depth + 1); }
        catch (error) { if (!missing(error)) issues.push(`${location.backend}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    try { await visit(location.directory, 0); }
    catch (error) { if (!missing(error)) issues.push(`${location.backend}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return skills;
}

/** Apps sync their bundled skills into `synced/<session>/` next to a manifest naming where each came from. */
async function syncedSource(folder: string, name: string): Promise<'anthropic' | 'other' | undefined> {
  const session = path.dirname(folder);
  if (path.basename(path.dirname(session)) !== 'synced') return undefined;
  try {
    const manifest = JSON.parse(await readFile(path.join(session, 'manifest.json'), 'utf8')) as { skills?: { name?: unknown; source?: unknown }[] };
    const source = manifest.skills?.find(entry => entry.name === name || entry.name === path.basename(folder))?.source;
    return typeof source === 'string' && source.startsWith('anthropic') ? 'anthropic' : 'other';
  } catch { return 'other'; }
}

function missing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '');
}
