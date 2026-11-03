import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { gitRepositoryKey, repositoryIconAliases, workspaceRepositoryKey } from '@workspace/core/repository-key';
import type { RunProfile } from '@workspace/core/run-profiles';
import { AgentGitService } from './git/agent-git-service';
import { storedRunProfileSchema } from './run-profile-schema';
import { parseStoreFile, serializeStoreFile } from './persistence/store-format';

const entrySchema = z.looseObject({ icon: z.string().max(131072).optional(), commands: z.array(storedRunProfileSchema).optional() });
const schema = z.looseObject({ repositories: z.record(z.string(), entrySchema) });
type Entry = z.infer<typeof entrySchema>;
type Entries = Record<string, Entry>;
const queues = new Map<string, Promise<unknown>>();
const iconPriority = (key: string) => key.startsWith('git:') ? 2 : key.startsWith('remote:') ? 1 : 0;

function mergeCommands(current: RunProfile[] = [], incoming: RunProfile[] = []): RunProfile[] {
  const merged = [...current];
  for (const command of incoming) {
    const existing = merged.find(item => item.id === command.id);
    if (!existing) { merged.push(command); continue; }
    if (JSON.stringify(existing) === JSON.stringify(command)) continue;
    const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    if (!merged.some(item => item.id === id)) merged.push({ ...command, id });
  }
  return merged;
}

/** Icons and commands share one serialized, host-owned repository document. */
export class RepositoryStore {
  private readonly file: string;
  constructor(filename: string, private readonly git = new AgentGitService()) { this.file = path.resolve(filename); }

  async key(value: string): Promise<string> {
    if (value.startsWith('file:')) {
      const url = new URL(value);
      if (url.host) return url.href;
      value = fileURLToPath(url);
    } else if (!path.isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
      const key = gitRepositoryKey(value);
      if (key) return key;
      throw new Error('Invalid repository identity.');
    }
    const folder = await realpath(value).catch(() => path.resolve(value));
    return workspaceRepositoryKey(await this.git.identity(folder));
  }

  transaction<T>(action: (entries: Entries) => T | Promise<T>): Promise<T> {
    const operation = (queues.get(this.file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let document: z.infer<typeof schema>;
      try { document = schema.parse(parseStoreFile(this.file, await readFile(this.file, 'utf8')).data); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; document = { repositories: {} }; }
      const before = JSON.stringify(document);
      // TODO(remove-after: 2026-11-30): Remove run-profiles.json import and retirement. https://github.com/nbonamy/korus/issues/74
      const legacyFile = path.join(path.dirname(this.file), 'run-profiles.json');
      let legacy: Record<string, RunProfile[]> | undefined;
      if (legacyFile !== this.file) {
        try { legacy = z.object({ repositories: z.record(z.string(), z.array(storedRunProfileSchema)) }).parse(parseStoreFile(legacyFile, await readFile(legacyFile, 'utf8')).data).repositories; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      for (const [folder, commands] of Object.entries(legacy ?? {})) {
        const key = await this.key(folder);
        const entry = document.repositories[key] ??= {};
        entry.commands = mergeCommands(entry.commands, commands);
      }
      const result = await action(document.repositories);
      if (JSON.stringify(document) !== before || legacy) {
        await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
        const content = serializeStoreFile(schema.parse(document));
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, this.file);
          if (process.platform !== 'win32') {
            const directory = await open(path.dirname(this.file), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
          }
          if (await readFile(this.file, 'utf8') !== content) throw new Error('Repository migration verification failed.');
        } finally { await unlink(temporary).catch(() => {}); }
      }
      if (legacy) await unlink(legacyFile);
      return structuredClone(result);
    });
    queues.set(this.file, operation);
    const clear = () => { if (queues.get(this.file) === operation) queues.delete(this.file); };
    void operation.then(clear, clear);
    return operation;
  }

  reconcile(entries: Entries, key: string, aliases: string[]): Entry {
    const entry = entries[key] ??= {};
    for (const alias of aliases) {
      if (alias === key || !entries[alias]) continue;
      const old = entries[alias]!;
      for (const [field, value] of Object.entries(old)) if (!(field in entry)) entry[field] = value;
      entry.icon ??= old.icon;
      if (old.commands) entry.commands = mergeCommands(entry.commands, old.commands);
      delete entries[alias];
    }
    return entry;
  }

  async icons(legacy?: Record<string, string>): Promise<Record<string, string>> {
    const normalized = await this.normalizeIcons(legacy ?? {});
    return this.transaction(entries => {
      for (const [key, icon] of Object.entries(normalized)) (entries[key] ??= {}).icon ??= icon;
      return this.projectIcons(entries);
    });
  }

  async replaceIcons(icons: Record<string, string>): Promise<void> {
    const normalized = await this.normalizeIcons(icons);
    await this.transaction(entries => {
      for (const [key, entry] of Object.entries(entries)) {
        delete entry.icon;
        if (!entry.commands?.length && Object.keys(entry).every(field => field === 'commands') && !(key in normalized)) delete entries[key];
      }
      for (const [key, icon] of Object.entries(normalized)) (entries[key] ??= {}).icon = icon;
    });
  }

  private async normalizeIcons(icons: Record<string, string>): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [raw, icon] of Object.entries(icons).sort(([a], [b]) => iconPriority(b) - iconPriority(a))) {
      const key = await this.key(raw);
      result[key] ??= icon;
    }
    return result;
  }
  private projectIcons(entries: Entries): Record<string, string> {
    return Object.fromEntries(Object.entries(entries).flatMap(([key, { icon }]) => icon === undefined ? [] : [[key.startsWith('file:') && !new URL(key).host ? fileURLToPath(key) : key.startsWith('git:') ? repositoryIconAliases(key).at(-1)! : key, icon]]));
  }
}
