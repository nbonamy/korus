import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanionConversation, CompanionConversationFrame, CompanionTarget } from '@workspace/core/companion-protocol';
import { ConversationCache } from '../conversation-cache';
const target = (agentId: string, sessionId = 'session'): CompanionTarget => ({ hostId: 'laptop', locationId: 'local', teamId: 'team', agentId, sessionId: JSON.stringify({ kind: 'cursor', sessionId: sessionId }) });
const state = (extra: Record<string, unknown> = {}) => ({ messages: [], busy: false, activeTurnId: null, turns: [], requests: [], error: null, title: null, goal: null, contextUsage: null, plan: null, ...extra }) as CompanionConversation['payload']['snapshot']['state'];
const reset = (agentId: string, revision = 1, epoch = 'epoch', conversation = 'session'): CompanionConversation =>
  ({ type: 'conversation.sessionSnapshot', agentId, provider: 'cursor', payload: { conversation, epoch, snapshot: { revision, state: state() } } });
const delta = (agentId: string, revision: number, ops: unknown[] = [{ op: 'set', key: 'activeTurnId', value: 'live-turn' }]): CompanionConversationFrame =>
  ({ type: 'conversation.sessionPatch', agentId, provider: 'cursor', payload: { conversation: 'session', epoch: 'epoch', patch: { revision, ops: ops as never } } });
const revision = (frame: CompanionConversation | null | undefined) => frame?.payload.snapshot.revision;
afterEach(() => vi.useRealTimers());
function fixture() {
  const changed = vi.fn();
  const request = vi.fn(async (method: string, value: CompanionTarget) => { if (method === 'conversation.subscribe') cache.receive(reset(value.agentId)); });
  const cache = new ConversationCache(request, changed);
  return { cache, request, changed };
}
describe('recent mobile conversations', () => {
  it('reloads after a patch it cannot apply without publishing an invalid state or poisoning cached selection', async () => {
    const changed = vi.fn();
    let reads = 0;
    const request = vi.fn(async () => { cache.receive({ ...reset('a', ++reads), payload: { ...reset('a', reads).payload, snapshot: { revision: reads, state: state({ messages: [{ id: 'answer', role: 'assistant', status: 'complete', parts: [] }] }) } } }); });
    const cache = new ConversationCache(request, changed);
    try {
      await cache.select(target('a'));
      cache.receive(delta('a', 2, [{ op: 'futureOp' }]));
      await Promise.resolve(); await Promise.resolve();
      expect(changed.mock.calls.every(([next]) => next.payload.snapshot.state.messages.length === 1)).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect((await cache.select(target('a')))?.payload.snapshot.state.messages[0]?.id).toBe('answer');
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
    expect((await f.cache.select(target('a')))?.payload.snapshot.revision).toBe(1);
    expect(f.request.mock.calls.filter(([method]) => method === 'conversation.subscribe')).toHaveLength(3);
  });
  it('unsubscribes hidden chats after five minutes but keeps their content visible while revalidating', async () => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.cache.select(target('a')); await f.cache.select(target('b'));
      await vi.advanceTimersByTimeAsync(299_000);
      f.cache.receive(delta('a', 2));
      expect(f.cache.peek(target('a'))?.payload.snapshot.state.activeTurnId).toBe('live-turn');
      expect((await f.cache.select(target('a')))?.payload.snapshot.state.activeTurnId).toBe('live-turn');
      expect(f.request.mock.calls.filter(([method]) => method === 'conversation.subscribe')).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_000); // Old A expiry was canceled by viewing it.
      expect(f.cache.peek(target('a'))).toBeTruthy();
      await f.cache.select(target('b')); // A gets a new five-minute deadline.
      await vi.advanceTimersByTimeAsync(299_999);
      f.cache.receive(delta('a', 3)); // Incoming events do not extend it.
      await vi.advanceTimersByTimeAsync(1);
      expect(f.request).toHaveBeenCalledWith('conversation.unsubscribe', target('a'));
      expect(f.cache.peek(target('a'))?.payload.snapshot.revision).toBe(3);
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
  it('drops frames of another conversation or provider without poisoning a subscribed chat', async () => {
    const f = fixture();
    try {
      await f.cache.select(target('a'));
      f.cache.receive(reset('a', 2, 'epoch', 'another-session'));
      f.cache.receive({ ...reset('a', 3), provider: 'codex' });
      expect(f.changed).toHaveBeenCalledTimes(1);
      expect(revision(f.cache.peek(target('a')))).toBe(1);
    } finally { f.cache.close(); }
  });
  it('takes a restarted stream at any revision and drops a late snapshot of the current one', async () => {
    const f = fixture();
    try {
      await f.cache.select(target('a'));
      f.cache.receive(delta('a', 2)); f.cache.receive(reset('a', 1));
      expect(revision(f.cache.peek(target('a')))).toBe(2);
      f.cache.receive(reset('a', 1, 'restarted'));
      expect(f.cache.peek(target('a'))?.payload).toMatchObject({ epoch: 'restarted', snapshot: { revision: 1 } });
      expect(f.changed).toHaveBeenCalledTimes(3);
    } finally { f.cache.close(); }
  });
});

it('retains cached content while disconnected and after a failed refresh, then applies a same-revision authoritative reset', async () => {
  const f = fixture();
  try {
    await f.cache.select(target('a'));
    f.cache.disconnect();
    expect(f.cache.peek(target('a'))?.payload.snapshot.revision).toBe(1);
    let reject!: (error: Error) => void;
    f.cache.reconnect((method, value) => method === 'conversation.subscribe' ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve({}));
    const refresh = f.cache.select(target('a'));
    expect(f.cache.peek(target('a'))?.payload.snapshot.revision).toBe(1);
    reject(new Error('offline'));
    await expect(refresh).rejects.toThrow('offline');
    expect(f.cache.peek(target('a'))?.payload.snapshot.revision).toBe(1);
    f.cache.reconnect(async (_method, value) => { f.cache.receive(reset(value.agentId)); });
    expect((await f.cache.select(target('a')))?.payload.snapshot.revision).toBe(1);
  } finally { f.cache.close(); }
});
