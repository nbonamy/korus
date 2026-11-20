import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectNarrative } from '@workspace/core/project-overview';
import { parseStoreFile, serializeStoreFile } from '../persistence/store-format';

/** The last narrative written for a repository, with the evidence it was written from and the branches each workstream claimed. */
export type StoredProjectNarrative = {
  evidenceKey: string;
  narrative: ProjectNarrative;
  workstreams: { id: string; branches: string[] }[];
};

const maxRepositories = 50;

/** Daemon-private. Keeps narratives across restarts so reopening an unchanged project spends nothing. A null file keeps them in memory only. */
export class ProjectNarrativeStore {
  private entries: Map<string, StoredProjectNarrative> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string | null) {}

  private async load(): Promise<Map<string, StoredProjectNarrative>> {
    if (this.entries) return this.entries;
    const entries = new Map<string, StoredProjectNarrative>();
    if (this.file) {
      try {
        const data = parseStoreFile(this.file, await readFile(this.file, 'utf8')).data as { repositories?: Record<string, StoredProjectNarrative> };
        for (const [repository, entry] of Object.entries(data.repositories ?? {})) {
          if (typeof entry?.evidenceKey === 'string' && typeof entry.narrative?.lead === 'string' && Array.isArray(entry.narrative.workstreams) && Array.isArray(entry.workstreams)) entries.set(repository, entry);
        }
      } catch {
        // A missing or unreadable file only means the next narrative is written again.
      }
    }
    return this.entries ??= entries;
  }

  async get(repository: string): Promise<StoredProjectNarrative | null> {
    return (await this.load()).get(repository) ?? null;
  }

  async set(repository: string, entry: StoredProjectNarrative): Promise<void> {
    const entries = await this.load();
    entries.delete(repository);
    entries.set(repository, entry);
    while (entries.size > maxRepositories) entries.delete(entries.keys().next().value!);
    const file = this.file;
    if (!file) return;
    const text = serializeStoreFile({ repositories: Object.fromEntries(entries) });
    this.writes = this.writes.then(async () => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, text, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    }).catch(() => undefined);
    await this.writes;
  }
}
