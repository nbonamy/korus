import { describe, expect, it } from 'vitest';
import { restoreDraftRecord } from '../protected-storage';

describe('draft records', () => {
  it('restores saved drafts with their cursor clamped to the text', () => {
    const record = { drafts: { '["laptop","agent"]': { text: 'draft', selectionStart: 50, selectionEnd: 50 } }, uncertain: { '["laptop","agent"]': true } };
    expect(restoreDraftRecord(JSON.parse(JSON.stringify(record)))).toStrictEqual({ drafts: { '["laptop","agent"]': { text: 'draft', selectionStart: 5, selectionEnd: 5 } }, uncertain: record.uncertain });
  });
  it('keeps delivery receipts that belong to a draft, and nothing else', () => {
    const key = '["laptop","agent"]';
    const restored = restoreDraftRecord({ drafts: { [key]: { text: 'x', selectionStart: 0, selectionEnd: 0 } }, uncertain: { [key]: false }, commandIds: { [key]: '11111111-1111-4111-8111-111111111111' }, submittedTexts: { [key]: 'x' } });
    expect(restored.commandIds).toStrictEqual({ [key]: '11111111-1111-4111-8111-111111111111' });
    expect(restored.submittedTexts).toStrictEqual({ [key]: 'x' });
    expect(() => restoreDraftRecord({ drafts: {}, uncertain: {}, commandIds: { foreign: '11111111-1111-4111-8111-111111111111' } })).toThrow('command identity');
    expect(() => restoreDraftRecord({ drafts: {}, uncertain: {}, submittedTexts: { foreign: 'x' } })).toThrow('submitted draft');
  });
  it('rejects corrupt records and delivery locks without a draft', () => {
    for (const corrupt of [{}, { drafts: null, uncertain: {} }, { drafts: { bad: {} }, uncertain: {} },
      { drafts: { '["laptop","agent"]': { text: 1 } }, uncertain: {} }, { drafts: {}, uncertain: { foreign: true } }]) {
      expect(() => restoreDraftRecord(corrupt)).toThrow();
    }
    expect(restoreDraftRecord(null)).toStrictEqual({ drafts: {}, uncertain: {} });
  });
});
