import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
import { normalizePromptContent } from '@codex-app-sdk/core/surface';

type Entry = { wireText: string; text: string; parts: RendererMessagePart[]; metadata?: RendererMessage['metadata'] };

/** Presentation metadata for our own admitted prompts; native ACP owns history. */
export class AcpPromptJournal {
  private replayIndex = 0;
  private constructor(private readonly file: string | null, private readonly entries: Entry[]) {}

  private static directory(home: string, sessionId: string): string {
    return path.join(home, 'korus-sessions', encodeURIComponent(sessionId));
  }

  /** Utility and review sessions keep no prompt text; the marker only hides them from history listings. */
  static async ephemeral(home: string, sessionId: string): Promise<AcpPromptJournal> {
    const directory = AcpPromptJournal.directory(home, sessionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'ephemeral'), '', { mode: 0o600 });
    return new AcpPromptJournal(null, []);
  }

  static isEphemeral(home: string, sessionId: string): Promise<boolean> {
    return stat(path.join(AcpPromptJournal.directory(home, sessionId), 'ephemeral')).then(() => true, () => false);
  }

  static async open(home: string, sessionId: string): Promise<AcpPromptJournal> {
    const file = path.join(AcpPromptJournal.directory(home, sessionId), 'prompts.jsonl');
    const entries: Entry[] = [];
    const size = await stat(file).then(value => value.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
    if (size > 20 * 1024 * 1024) throw new Error('Antigravity prompt metadata exceeds the supported history limit.');
    // A crash mid-append can leave a torn line; drop it so history still opens with native text.
    if (size) for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) {
      const entry = parseEntry(line);
      if (entry) entries.push(entry);
    }
    return new AcpPromptJournal(file, entries);
  }

  async append(entry: Entry): Promise<void> {
    if (!this.file) return;
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    this.entries.push(structuredClone(entry));
  }

  display(nativeText: string): { text: string; parts: RendererMessagePart[]; metadata?: RendererMessage['metadata'] } {
    const index = this.entries.findIndex((candidate, index) => {
      if (index < this.replayIndex) return false;
      const text = candidate.wireText.replace(/^\/plan\s*/, '').trimStart();
      return text.length > 0 && nativeText.trimStart().startsWith(text);
    });
    const entry = this.entries[index];
    if (entry) this.replayIndex = index + 1;
    return entry ? structuredClone({ text: entry.text, parts: entry.parts, ...(entry.metadata ? { metadata: entry.metadata } : {}) }) : { text: nativeText, parts: [] };
  }
}

function parseEntry(line: string): Entry | null {
  try {
    const entry = JSON.parse(line) as Entry;
    if (entry.metadata?.promptContent !== undefined) entry.metadata.promptContent = normalizePromptContent(entry.metadata.promptContent);
    return typeof entry.wireText === 'string' && typeof entry.text === 'string' && Array.isArray(entry.parts)
      && entry.parts.every(part => part.type === 'attachment') ? entry : null;
  } catch { return null; }
}
