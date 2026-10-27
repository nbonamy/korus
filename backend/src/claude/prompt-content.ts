import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePromptContent, promptContentText, type CodexPromptPart } from '@codex-app-sdk/core/surface';
import type { RendererMessage } from '@workspace/core/contracts';

export function promptContentDirectory(home: string, sessionId: string): string {
  return path.join(home, 'prompt-content', createHash('sha256').update(sessionId).digest('hex'));
}

export async function savePromptContent(home: string, sessionId: string, messageId: string, content: readonly CodexPromptPart[]): Promise<void> {
  const directory = promptContentDirectory(home, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${messageId}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(normalizePromptContent(content)), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

/** Only native user UUIDs with authored records can recover chips; text is never inferred. */
export async function restorePromptContent(home: string, sessionId: string, messages: RendererMessage[]): Promise<void> {
  const directory = promptContentDirectory(home, sessionId);
  const names = new Set(await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }));
  const prefix = `user-${sessionId}-`;
  await Promise.all(messages.map(async message => {
    if (message.role !== 'user' || !message.id.startsWith(prefix)) return;
    const id = message.id.slice(prefix.length);
    if (!/^[a-f0-9-]{36}$/i.test(id) || !names.has(`${id}.json`)) return;
    const content = normalizePromptContent(JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')));
    message.metadata = { ...message.metadata, promptContent: content };
    const text = message.parts.find(part => part.type === 'text');
    if (text?.type === 'text') text.text = promptContentText(content);
  }));
}
