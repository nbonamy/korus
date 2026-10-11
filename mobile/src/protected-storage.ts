import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CodexComposerState } from '@codex-app-sdk/vue';

export type DraftRecord = { drafts: Record<string, CodexComposerState>; uncertain: Record<string, boolean> };
export type DraftStore = { read(): Promise<unknown>; write(record: DraftRecord): Promise<void> };
export type ProtectedVault = {
  read(options: { key: string }): Promise<{ value: string | null }>;
  write(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};
export const protectedVault = registerPlugin<ProtectedVault>('CompanionVault');

/** Production storage exists only on native hosts; credentials never fall back to browser storage. */
export function createNativeDraftStore(vault = protectedVault): DraftStore {
  if (!Capacitor.isNativePlatform()) throw new Error('Protected storage requires a native host.');
  return {
    async read() {
      const { value } = await vault.read({ key: 'drafts' });
      return value === null ? null : JSON.parse(value);
    },
    async write(record) { await vault.write({ key: 'drafts', value: JSON.stringify(record) }); },
  };
}

export function restoreDraftRecord(value: unknown): DraftRecord {
  const restored: DraftRecord = { drafts: {}, uncertain: {} };
  if (value === null) return restored;
  if (!value || typeof value !== 'object' || !('drafts' in value) || !('uncertain' in value)) throw new Error('Invalid draft record.');
  const record = value as DraftRecord;
  if (!record.drafts || !record.uncertain || typeof record.drafts !== 'object' || typeof record.uncertain !== 'object') throw new Error('Invalid draft record.');
  for (const [key, draft] of Object.entries(record.drafts)) {
    const identity: unknown = JSON.parse(key);
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every((part) => typeof part === 'string')
      || !draft || typeof draft.text !== 'string' || !Number.isInteger(draft.selectionStart) || !Number.isInteger(draft.selectionEnd)) throw new Error('Invalid draft.');
    restored.drafts[key] = { text: draft.text, selectionStart: Math.max(0, Math.min(draft.text.length, draft.selectionStart)),
      selectionEnd: Math.max(0, Math.min(draft.text.length, draft.selectionEnd)) };
  }
  for (const [key, uncertain] of Object.entries(record.uncertain)) {
    if (!Object.hasOwn(restored.drafts, key) || typeof uncertain !== 'boolean') throw new Error('Invalid delivery state.');
    restored.uncertain[key] = uncertain;
  }
  return restored;
}
