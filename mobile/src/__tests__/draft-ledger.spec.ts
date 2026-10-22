import { describe, expect, it, vi } from 'vitest';
import { createDraftLedger } from '../draft-ledger';
import type { DraftRecord } from '../protected-storage';

const draft = (text: string) => ({ text, selectionStart: text.length, selectionEnd: text.length });
function store(initial: unknown = null) {
  const writes: DraftRecord[] = []; let failNext = false;
  return { writes, failNext: () => { failNext = true; },
    store: { read: async () => initial, write: async (record: DraftRecord) => { if (failNext) { failNext = false; throw new Error('locked'); } writes.push(record); } } };
}

describe('draft ledger', () => {
  it('restores what was typed and what was sent before the app was closed, and is ready only then', async () => {
    const key = JSON.stringify(['laptop', 'agent']); const command = crypto.randomUUID();
    const s = store({ drafts: { [key]: draft('hello') }, uncertain: { [key]: true }, commandIds: { [key]: command }, submittedTexts: { [key]: 'hello' } });
    const ledger = createDraftLedger(s.store, vi.fn());
    expect(ledger.storageReady.value).toBe(false);
    await ledger.ready;
    expect(ledger.storageReady.value).toBe(true);
    expect([ledger.drafts[key]?.text, ledger.uncertain[key], ledger.commandIds[key], ledger.submittedTexts[key]]).toStrictEqual(['hello', true, command, 'hello']);
  });

  it('stays unready and reports it when the stored record cannot be read', async () => {
    const onError = vi.fn(); const ledger = createDraftLedger(store({ nonsense: true }).store, onError);
    await ledger.ready;
    expect(ledger.storageReady.value).toBe(false); expect(onError).toHaveBeenCalledOnce(); expect(ledger.storageFailed).toBe(true);
  });

  it('writes in order, reports a failed write, and keeps working afterwards', async () => {
    const s = store(); const onError = vi.fn(); const ledger = createDraftLedger(s.store, onError);
    await ledger.ready;
    ledger.drafts.a = draft('one'); await ledger.persist();
    s.failNext(); ledger.drafts.a = draft('two');
    await expect(ledger.persist()).rejects.toThrow('locked');
    expect(onError).toHaveBeenCalledOnce(); expect(ledger.storageFailed).toBe(true);
    ledger.drafts.a = draft('three'); await ledger.persist();
    expect(ledger.storageFailed).toBe(false);
    expect(s.writes.map(record => record.drafts.a?.text)).toStrictEqual(['one', 'three']);
  });

  it('needs no store at all', async () => {
    const ledger = createDraftLedger(undefined, vi.fn());
    expect(ledger.storageReady.value).toBe(true);
    await expect(ledger.persist()).resolves.toBeUndefined();
  });
});
