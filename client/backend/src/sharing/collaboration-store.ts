import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renameProviderFields } from '../persistence/migrations';

type Section = 'sharing' | 'guestJoins';
/** Version 2 stores agent providers as `provider` instead of `backend`; version 1 is upgraded on read and rewritten on the next update. */
type Document = { v: 2; sharing?: unknown; guestJoins?: unknown };
const writes = new Map<string, Promise<void>>();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** One atomic document; each service owns a section, never the other service's snapshot. */
export class CollaborationStore {
  private readonly file: string;
  constructor(private readonly directory: string) { this.file = path.resolve(directory, 'collaboration.json'); }

  async read(section: Section): Promise<unknown> { return (await this.readDocument())[section]; }

  update(section: Section, value: unknown): Promise<void> {
    const encoded = JSON.stringify(value);
    const next = (writes.get(this.file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const document = await this.readDocument();
      document[section] = JSON.parse(encoded);
      const content = JSON.stringify(document);
      if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error('Collaboration state is too large.');
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.file);
        if (process.platform !== 'win32') {
          const directory = await open(this.directory, 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally { await unlink(temporary).catch(() => {}); }
    });
    writes.set(this.file, next);
    const clear = () => { if (writes.get(this.file) === next) writes.delete(this.file); };
    void next.then(clear, clear);
    return next;
  }

  private async readDocument(): Promise<Document> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid collaboration directory.');
    await chmod(this.directory, 0o700);
    try {
      const file = await lstat(this.file);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 32 * 1024 * 1024) throw new Error('Invalid collaboration file.');
      await chmod(this.file, 0o600);
      const stored: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      const value = record(stored) && stored.v === 1 ? { ...(renameProviderFields(stored) as Record<string, unknown>), v: 2 } : stored;
      if (!record(value) || value.v !== 2 || Object.keys(value).some(key => !['v', 'sharing', 'guestJoins'].includes(key))
        || (value.sharing !== undefined && !record(value.sharing)) || (value.guestJoins !== undefined && !record(value.guestJoins))) throw new Error('Invalid collaboration state.');
      return value as Document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { v: 2 };
      throw error;
    }
  }
}
