import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { maxThemeFileSize, parseCustomTheme, skinNamePattern, type CustomAppTheme, type LocalSkin, type SkinControlInput, type SkinControlResult } from '@workspace/core/custom-themes';

/** Saves editable skin sources; appearance itself goes through normal client preferences. */
export class CustomSkinStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string, private readonly apply: (skin: CustomAppTheme | null) => Promise<void>, private readonly activeId: () => string | undefined = () => undefined) {}

  set(input: SkinControlInput): Promise<SkinControlResult> {
    return this.enqueue(() => this.update(input));
  }

  remove(name: string): Promise<void> {
    return this.enqueue(async () => {
      const file = this.source(name);
      const skin = parseCustomTheme(JSON.parse(await readFile(file, 'utf8')));
      if (this.activeId() === skin.id) await this.apply(null);
      await rm(file);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Valid sources only: a half-edited or foreign file must not break the picker. */
  async list(): Promise<LocalSkin[]> {
    const files = await readdir(this.directory).catch(() => [] as string[]);
    const skins = await Promise.all(files.sort().map(async file => {
      const name = file.endsWith('.json') ? file.slice(0, -5) : '';
      if (!skinNamePattern.test(name)) return null;
      try {
        const source = path.join(this.directory, file);
        if ((await stat(source)).size > maxThemeFileSize) return null;
        return { name, skin: parseCustomTheme(JSON.parse(await readFile(source, 'utf8'))) };
      } catch { return null; }
    }));
    return skins.filter(entry => entry !== null);
  }

  private async update(input: SkinControlInput): Promise<SkinControlResult> {
    if (input.name === null) {
      if (input.definition !== undefined) throw new Error('Disabling a skin cannot include a definition.');
      await this.apply(null);
      return { enabled: false, name: null };
    }
    const file = this.source(input.name);
    const text = input.definition === undefined ? await readFile(file, 'utf8') : JSON.stringify(input.definition, null, 2);
    if (Buffer.byteLength(text, 'utf8') > maxThemeFileSize) throw new Error('Skin file is too large.');
    const skin = parseCustomTheme(JSON.parse(text));
    if (input.definition !== undefined) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${text}\n`, { mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    }
    // Always read and apply, including the already-active name: the source may have changed.
    await this.apply(skin);
    return { enabled: true, name: input.name, path: file, skin: { id: skin.id, name: skin.name, appearance: skin.appearance } };
  }

  private source(name: string): string {
    if (typeof name !== 'string' || !skinNamePattern.test(name)) throw new Error('Skin name must contain lowercase letters, digits or hyphens (1–64 characters).');
    return path.join(this.directory, `${name}.json`);
  }
}
