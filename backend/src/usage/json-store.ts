import { open } from "node:fs/promises";
/** Bounded reader for migration of legacy numeric statistics. */
export class JsonStore {
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
}
