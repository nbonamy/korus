import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RendererMessage, RendererMessagePart } from '@workspace/core/contracts';
import { normalizePromptContent } from '@codex-app-sdk/core/surface';

type Entry = { wireText: string; text: string; parts: RendererMessagePart[]; metadata?: RendererMessage['metadata'] };

/** Presentation metadata for our own admitted prompts; native ACP owns history. */
export class CursorPromptJournal {
  private replayIndex = 0;
  private constructor(private readonly file: string | null, private readonly entries: Entry[]) {}

  private static directory(home: string, sessionId: string): string {
    return path.join(home, 'korus-sessions', encodeURIComponent(sessionId));
  }

  static async open(home: string, sessionId: string): Promise<CursorPromptJournal> {
    const file = path.join(CursorPromptJournal.directory(home, sessionId), 'prompts.jsonl');
    const entries: Entry[] = [];
    const size = await stat(file).then(value => value.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
    if (size > 20 * 1024 * 1024) throw new Error('Cursor prompt metadata exceeds the supported history limit.');
    // A crash mid-append can leave a torn line; drop it so history still opens with native text.
    if (size) for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) {
      const entry = parseEntry(line);
      if (entry) entries.push(entry);
    }
    return new CursorPromptJournal(file, entries);
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
      return nativeText === candidate.wireText;
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
