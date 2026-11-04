/**
 * Remembers the content each file last held, read or written, so saving identical content costs no disk I/O.
 * Each persisted store owns one instance: a fresh store starts empty and writes whatever it is asked to save.
 * Call `remember` after loading a file.
 */
export class UnchangedWrites {
  private readonly known = new Map<string, string>();

  remember(file: string, content: string): void {
    this.known.set(file, content);
  }

  /** Forget a file that was deleted or may have been replaced, so the next save writes it. */
  forget(file: string): void {
    this.known.delete(file);
  }

  /** Runs `write` unless the file already holds `content`. Returns whether it wrote. */
  async writeIfChanged(file: string, content: string, write: (file: string, content: string) => Promise<void>): Promise<boolean> {
    if (this.known.get(file) === content) return false;
    // A failed write must not leave the new content remembered as if it were on disk.
    this.known.delete(file);
    await write(file, content);
    this.known.set(file, content);
    return true;
  }
}
