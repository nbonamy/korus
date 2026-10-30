import type { ConversationContentInput, ConversationContentChunk } from './contracts/conversation';

export type ConversationDiffContent = { sessionId: string; contentId: string; byteLength: number; changeKind: 'add' | 'update' | 'delete' };

/** Exact historical patches are read independently of the current working-tree file. */
export async function readConversationDiff(path: string, content: ConversationDiffContent,
  read: (input: ConversationContentInput) => Promise<ConversationContentChunk>, current: () => boolean = () => true): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(content.contentId) || !content.sessionId || !Number.isSafeInteger(content.byteLength)
    || content.byteLength <= 0 || content.byteLength > 128 * 1024 * 1024 || !['add', 'update', 'delete'].includes(content.changeKind)) throw new Error('Invalid diff reference.');
  const decoder = new TextDecoder('utf-8', { fatal: true }); const chunks: string[] = []; let offset = 0;
  for (;;) {
    if (!current()) throw new Error('Conversation changed.');
    const chunk = await read({ sessionId: content.sessionId, contentId: content.contentId, offset });
    if (!current()) throw new Error('Conversation changed.');
    if (chunk.data.length > 90_000) throw new Error('Invalid diff chunk.');
    const bytes = Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0)); const end = offset + bytes.length;
    if (!bytes.length || bytes.length > 65536 || chunk.totalBytes !== content.byteLength || end > content.byteLength
      || chunk.nextOffset !== (end < content.byteLength ? end : null)) throw new Error('Invalid diff chunk.');
    chunks.push(decoder.decode(bytes, { stream: chunk.nextOffset !== null }));
    if (chunk.nextOffset === null) break;
    offset = end;
  }
  const diff = chunks.join('');
  if (content.changeKind === 'update' && diff.startsWith('diff --git ')) return diff;
  const old = JSON.stringify(`a/${path}`); const next = JSON.stringify(`b/${path}`);
  const header = `diff --git ${old} ${next}\n--- ${content.changeKind === 'add' ? '/dev/null' : old}\n+++ ${content.changeKind === 'delete' ? '/dev/null' : next}\n`;
  if (content.changeKind === 'update') return header + diff;
  const lines = diff.split('\n'); if (diff.endsWith('\n')) lines.pop();
  const addition = content.changeKind === 'add';
  return header + `@@ -${addition ? '0,0' : `1,${lines.length}`} +${addition ? `1,${lines.length}` : '0,0'} @@\n`
    + lines.map(line => `${addition ? '+' : '-'}${line}\n`).join('') + (diff.endsWith('\n') ? '' : '\\ No newline at end of file\n');
}
