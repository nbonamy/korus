/** A prompt draft as the composer holds it. */
export type DraftState = { text: string; selectionStart: number; selectionEnd: number };

export type DraftRecord = { drafts: Record<string, DraftState>; uncertain: Record<string, boolean>; commandIds?: Record<string, string>; submittedTexts?: Record<string, string> };
export type DraftStore = { read(): Promise<unknown>; write(record: DraftRecord): Promise<void> };
export type ProtectedVault = {
  read(options: { key: string }): Promise<{ value: string | null }>;
  write(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

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
  if (record.commandIds) {
    restored.commandIds = {};
    for (const [key, id] of Object.entries(record.commandIds)) {
      if (!Object.hasOwn(restored.drafts, key) || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid command identity.');
      restored.commandIds[key] = id;
    }
  }
  if (record.submittedTexts) {
    restored.submittedTexts = {};
    for (const [key, text] of Object.entries(record.submittedTexts)) {
      if (!Object.hasOwn(restored.drafts, key) || typeof text !== 'string') throw new Error('Invalid submitted draft.');
      restored.submittedTexts[key] = text;
    }
  }
  return restored;
}
