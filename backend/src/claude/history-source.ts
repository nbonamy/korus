import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { ClaudeConversationTurn, RendererMessage, ThreadGoal } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import type { ClaudeTaskPlan } from './claude-task-plan';

export type ClaudeHistoryState = { taskPlan?: ClaudeTaskPlan; goal?: ThreadGoal | null; subagentEvents?: BackendEvent[] };

export type ClaudeHistorySource = {
  readTurn(turnId: string): Promise<RendererMessage[]>;
  readAll(): Promise<RendererMessage[]>;
  isCurrent(): Promise<boolean>;
  loadEarlier?(): Promise<ClaudeHistoryState & { messages: RendererMessage[]; turns: ClaudeConversationTurn[]; source: ClaudeHistorySource }>;
};

export type ClaudeTurnRange = { start: number; end: number };
type IndexedRange = ClaudeTurnRange & { hash: string };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Ephemeral index of one native transcript snapshot. No provider data is copied to disk. */
export async function createClaudeHistorySource(
  file: string,
  content: string,
  ranges: Map<string, ClaudeTurnRange>,
  decode: (content: string) => RendererMessage[],
  snapshot?: { offset: number; version: Stats },
): Promise<ClaudeHistorySource> {
  const version = snapshot?.version ?? await stat(file);
  const offset = snapshot?.offset ?? 0;
  const bytes = Buffer.from(content);
  const whole: IndexedRange = { start: offset, end: offset + bytes.length, hash: hash(bytes) };
  const index = new Map<string, IndexedRange>();
  for (const [id, range] of ranges) index.set(id, { start: offset + range.start, end: offset + range.end, hash: hash(bytes.subarray(range.start, range.end)) });

  const read = async (range: IndexedRange): Promise<RendererMessage[]> => {
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) throw new Error('Claude history is unavailable. Restore it or reload the conversation.');
    try {
      const current = await handle.stat();
      if (current.ino !== version.ino || current.dev !== version.dev || current.size < range.end) throw new Error('changed');
      const result = Buffer.allocUnsafe(range.end - range.start);
      let offset = 0;
      while (offset < result.length) {
        const { bytesRead } = await handle.read(result, offset, result.length - offset, range.start + offset);
        if (!bytesRead) throw new Error('changed');
        offset += bytesRead;
      }
      // Appends leave indexed turns valid; truncation, replacement and in-place rewrites do not.
      if (hash(result) !== range.hash) throw new Error('changed');
      return decode(result.toString('utf8'));
    } catch {
      throw new Error('Claude history changed. Reload the conversation before loading details.');
    } finally { await handle.close(); }
  };

  return {
    async readTurn(turnId) {
      const range = index.get(turnId);
      if (!range) throw new Error('Claude turn is no longer available. Reload the conversation.');
      return (await read(range)).filter(message => message.turnId === turnId);
    },
    readAll: () => read(whole),
    async isCurrent() {
      const current = await stat(file).catch(() => null);
      return current !== null && current.ino === version.ino && current.dev === version.dev
        && current.size === whole.end && current.mtimeMs === version.mtimeMs;
    },
  };
}
