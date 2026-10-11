import { mkdir, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";
/** Single owning daemon, serialized atomic replacement. No log of payloads or errors. */
export class JsonStore<T> {
  private writes: Promise<void> = Promise.resolve();
  constructor(
    private readonly file: string,
    private readonly maxReadBytes = 16 * 1024 * 1024,
  ) {}
  async read(): Promise<unknown> {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(this.file, "r");
      if ((await file.stat()).size > this.maxReadBytes) return null;
      const bytes = Buffer.alloc(this.maxReadBytes + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      return bytesRead > this.maxReadBytes
        ? null
        : JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } catch {
      return null;
    } finally {
      await file?.close();
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
