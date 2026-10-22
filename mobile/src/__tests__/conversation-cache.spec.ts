import { codexConversationSnapshot, codexTextMessage } from '../../../vue/src/test/codex-conversation-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanionReset, CompanionTarget } from '@workspace/core/companion-protocol';
import type { ProviderConversationFrame } from '@workspace/core/contracts';
import { ConversationCache } from '../conversation-cache';
const target = (agentId: string, sessionId = 'session'): CompanionTarget => ({ hostId: 'laptop', locationId: 'local', teamId: 'team', agentId, sessionId: JSON.stringify({ kind: 'claude', sessionId }) });
const reset = (agentId: string, revision = 1): CompanionReset => ({ type: 'claude.conversationSnapshotChanged', agentId, backend: 'claude', seq: revision, occurredAt: 'now', payload: { revision, snapshot: {
  agentId, sessionId: 'session', activeTurnId: null, turnIds: [], turns: [], messages: [], answeredClientRequestIds: [], busy: false, historyLoading: false, historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null,
} } }) as CompanionReset;
const delta = (agentId: string, revision: number): ProviderConversationFrame => ({ type: 'claude.conversationEventReceived', agentId, backend: 'claude', seq: revision, occurredAt: 'now', payload: { revision, event: { type: 'turn.started', agentId, backend: 'claude', turnId: 'live-turn', occurredAt: 'now', payload: { turn: { id: 'live-turn', backend: 'claude' } } } } }) as ProviderConversationFrame;
afterEach(() => vi.useRealTimers());
function fixture() {
  const changed = vi.fn();
  const request = vi.fn(async (method: string, value: CompanionTarget) => { if (method === 'conversation.subscribe') cache.receive(reset(value.agentId)); });
  const cache = new ConversationCache(request, changed);
  return { cache, request, changed };
}
describe('recent mobile conversations', () => {
  it('rehydrates an unsupported provider event without publishing an invalid snapshot or poisoning cached selection', async () => {
    const changed = vi.fn();
    const selected = { ...target('a'), sessionId: JSON.stringify({ kind: 'codex', threadId: 'thread' }) };
    const frame = (revision: number): CompanionReset => ({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: 'a', threadId: 'thread', seq: revision, occurredAt: 'now',
      payload: { revision, snapshot: codexConversationSnapshot([codexTextMessage('answer', 'assistant', 'Authoritative answer')], { activeConversationId: 'thread' }) } });
    let reads = 0;
    const request = vi.fn(async () => { cache.receive(frame(++reads)); });
    const cache = new ConversationCache(request, changed);
    try {
      await cache.select(selected);
      cache.receive({ type: 'codex.conversationEventReceived', backend: 'codex', agentId: 'a', threadId: 'thread', seq: 2, occurredAt: 'now', payload: {
        revision: 2, event: { type: 'conversation.futureEvent', conversationId: 'thread', seq: 2, payload: {} },
      } } as unknown as ProviderConversationFrame);
      await Promise.resolve(); await Promise.resolve();
      expect(changed.mock.calls.every(([next]) => next.payload.snapshot?.messages?.length === 1)).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect((await cache.select(selected))?.payload.snapshot.messages[0]?.id).toBe('answer');
    } finally { cache.close(); }
  });

  it('leaves the link alone when a background reload fails and reloads the chat on its next selection', async () => {
    const f = fixture(); let offline = false;
    f.request.mockImplementation(async (method, value) => {
      if (offline) throw new Error('Request timed out.');
      if (method === 'conversation.subscribe') f.cache.receive(reset(value.agentId));
    });
    await f.cache.select(target('a'));
    offline = true;
    f.cache.receive(delta('a', 5)); // a revision gap forces a reload, which fails
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    for (let turn = 0; turn < 6; turn++) await Promise.resolve(); // let the failed reload settle
    offline = false;
    expect((await f.cache.select(target('a')))?.payload.revision).toBe(1);
    expect(f.request.mock.calls.filter(([method]) => method === 'conversation.subscribe')).toHaveLength(3);
  });
  it('unsubscribes hidden chats after five minutes but keeps their content visible while revalidating', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.cache.select(target('a')); await f.cache.select(target('b'));
      await vi.advanceTimersByTimeAsync(299_000);
      f.cache.receive(delta('a', 2));
      expect(f.cache.peek(target('a'))?.payload.snapshot.activeTurnId).toBe('live-turn');
      expect((await f.cache.select(target('a')))?.payload.snapshot.activeTurnId).toBe('live-turn');
      expect(f.request.mock.calls.filter(([method]) => method === 'conversation.subscribe')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_000); // Old A expiry was canceled by viewing it.
      expect(f.cache.peek(target('a'))).toBeTruthy();
      await f.cache.select(target('b')); // A gets a new five-minute deadline.
      await vi.advanceTimersByTimeAsync(299_999);
      f.cache.receive(delta('a', 3)); // Incoming events do not extend it.
      await vi.advanceTimersByTimeAsync(1);
      expect(f.request).toHaveBeenCalledWith('conversation.unsubscribe', target('a'));
      expect(f.cache.peek(target('a'))?.payload.revision).toBe(3);
      await f.cache.select(target('a'));
      expect(f.request.mock.calls.filter(([method, value]) => method === 'conversation.subscribe' && value.agentId === 'a')).toHaveLength(2);
    } finally { f.cache.close(); }
  });
  it('recovers missing revisions, ignores duplicate updates, and releases timers on background/disconnect', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.cache.select(target('a'));
      f.cache.receive(delta('a', 2)); f.cache.receive(delta('a', 2));
      expect(f.changed).toHaveBeenCalledTimes(2);
      f.cache.receive(delta('a', 4)); await Promise.resolve(); await Promise.resolve();
      expect(f.request.mock.calls.filter(([method]) => method === 'conversation.subscribe')).toHaveLength(2);
      await f.cache.select(target('b')); f.cache.close();
      f.request.mockClear(); await vi.advanceTimersByTimeAsync(600_000);
      f.cache.receive(delta('a', 5));
      expect(f.request).not.toHaveBeenCalled(); expect(f.cache.peek(target('a'))).toBeUndefined();
    } finally { f.cache.close(); }
  });
  it('does not expose a failed load as an empty chat and can recover on the next selection', async () => {
    const f = fixture();
    try {
      f.request.mockRejectedValueOnce(new Error('Unavailable'));
      await expect(f.cache.select(target('a'))).rejects.toThrow('Unavailable');
      expect(f.cache.peek(target('a'))).toBeUndefined();
      expect((await f.cache.select(target('a')))?.agentId).toBe('a');
    } finally { f.cache.close(); }
  });
  it('replaces an in-flight load when the session changes and preserves its hidden expiry', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      let finish!: () => void;
      f.request.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      const old = f.cache.select(target('a'));
      await f.cache.select(target('b')); await vi.advanceTimersByTimeAsync(240_000);
      f.cache.reconcile([target('a', 'replacement'), target('b')]);
      await Promise.resolve(); await Promise.resolve();
      finish(); expect(await old).toBeNull();
      expect(f.request).toHaveBeenCalledWith('conversation.subscribe', target('a', 'replacement'), null);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(f.request).toHaveBeenCalledWith('conversation.unsubscribe', target('a', 'replacement'));
    } finally { f.cache.close(); }
  });
  it('invalidates removed agents and reloads changed sessions instead of reusing their cached transcript', async () => {
    const f = fixture();
    try {
      await f.cache.select(target('a')); await f.cache.select(target('b'));
      f.cache.reconcile([target('a', 'replacement')]);
      await Promise.resolve(); await Promise.resolve();
      expect(f.cache.peek(target('b'))).toBeUndefined();
      expect(f.request).toHaveBeenCalledWith('conversation.subscribe', target('a', 'replacement'), null);
      expect(f.cache.peek(target('a'))).toBeUndefined();
    } finally { f.cache.close(); }
  });
});

it('retains cached content while disconnected and after a failed refresh, then applies a same-revision authoritative reset', async () => {
  const f = fixture();
  try {
    await f.cache.select(target('a'));
    f.cache.disconnect();
    expect(f.cache.peek(target('a'))?.payload.revision).toBe(1);
    let reject!: (error: Error) => void;
    f.cache.reconnect((method, value) => method === 'conversation.subscribe' ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve({}));
    const refresh = f.cache.select(target('a'));
    expect(f.cache.peek(target('a'))?.payload.revision).toBe(1);
    reject(new Error('offline'));
    await expect(refresh).rejects.toThrow('offline');
    expect(f.cache.peek(target('a'))?.payload.revision).toBe(1);
    f.cache.reconnect(async (_method, value) => { f.cache.receive(reset(value.agentId)); });
    expect((await f.cache.select(target('a')))?.payload.revision).toBe(1);
  } finally { f.cache.close(); }
});
