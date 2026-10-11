import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => vi.fn(() => true));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native }, registerPlugin: () => ({}) }));
import { createNativeDraftStore, restoreDraftRecord } from '../protected-storage';

describe('protected draft storage', () => {
  beforeEach(() => native.mockReturnValue(true));
  it('round trips device records exclusively through the native vault', async () => {
    let saved: string | null = null;
    const vault = { read: vi.fn(async () => ({ value: saved })), write: vi.fn(async ({ value }) => { saved = value; }), remove: vi.fn() };
    const store = createNativeDraftStore(vault);
    expect(await store.read()).toBeNull();
    const record = { drafts: { '["laptop","agent"]': { text: 'draft', selectionStart: 50, selectionEnd: 50 } }, uncertain: { '["laptop","agent"]': true } };
    await store.write(record);
    expect(restoreDraftRecord(await store.read())).toStrictEqual({ drafts: { '["laptop","agent"]': { text: 'draft', selectionStart: 5, selectionEnd: 5 } }, uncertain: record.uncertain });
    expect(vault.write).toHaveBeenCalledWith({ key: 'drafts', value: JSON.stringify(record) });
  });
  it('rejects unavailable native hosts, corrupt records and delivery locks without a draft', async () => {
    native.mockReturnValue(false);
    expect(() => createNativeDraftStore()).toThrow('native host');
    for (const corrupt of [{}, { drafts: null, uncertain: {} }, { drafts: { bad: {} }, uncertain: {} },
      { drafts: { '["laptop","agent"]': { text: 1 } }, uncertain: {} }, { drafts: {}, uncertain: { foreign: true } }]) {
      expect(() => restoreDraftRecord(corrupt)).toThrow();
    }
    expect(restoreDraftRecord(null)).toStrictEqual({ drafts: {}, uncertain: {} });
  });
});
