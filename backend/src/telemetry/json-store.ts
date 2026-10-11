import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
/** Single owning daemon, serialized atomic replacement. No log of payloads or errors. */
export class JsonStore<T> {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      return null;
    }
  }
  save(value: T): Promise<void> {
    const bytes = JSON.stringify(value);
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file + ".tmp", bytes, { mode: 0o600 });
        await rename(this.file + ".tmp", this.file);
      });
    return this.writes;
  }
  async close(): Promise<void> {
    await this.writes;
  }
}
