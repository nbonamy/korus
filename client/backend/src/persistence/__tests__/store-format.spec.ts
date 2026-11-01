import { describe, expect, it } from 'vitest';
import { migrateData, type Migration } from '../migrations';
import { StoreFormatError, parseStoreFile, serializeStoreFile, storeSchemaVersion } from '../store-format';

describe('store file format', () => {
  it('round-trips data through the versioned envelope and names the writer', () => {
    const envelope = parseStoreFile('roster.json', serializeStoreFile({ hello: 'world' }));
    expect(envelope).toStrictEqual({ schemaVersion: storeSchemaVersion, writtenBy: expect.stringMatching(/^daemon \d/), data: { hello: 'world' } });
  });

  it('refuses a file written by a newer schema and says who wrote it', () => {
    const newer = JSON.stringify({ schemaVersion: storeSchemaVersion + 1, writtenBy: 'daemon 9.9.9', data: {} });
    expect(() => parseStoreFile('roster.json', newer)).toThrowError(StoreFormatError);
    expect(() => parseStoreFile('roster.json', newer)).toThrowError(/daemon 9\.9\.9/);
  });

  it.each([
    ['not json', '# retired'],
    ['no version', JSON.stringify({ data: {} })],
    ['version zero', JSON.stringify({ schemaVersion: 0, data: {} })],
    ['no data', JSON.stringify({ schemaVersion: 1 })],
    ['an array', '[]'],
  ])('rejects %s instead of treating it as empty state', (_label, text) => {
    expect(() => parseStoreFile('settings.json', text)).toThrowError(StoreFormatError);
  });
});

describe('migration runner', () => {
  const steps: Migration[] = [
    { from: 1, to: 2, up: (value) => ({ ...(value as object), second: true }) },
    { from: 2, to: 3, up: (value) => ({ ...(value as object), third: true }) },
  ];

  it('applies contiguous steps in order up to the target', () => {
    expect(migrateData('roster.json', { first: true }, 1, 3, steps)).toStrictEqual({ first: true, second: true, third: true });
    expect(migrateData('roster.json', { first: true }, 2, 3, steps)).toStrictEqual({ first: true, third: true });
    const current = { untouched: true };
    expect(migrateData('roster.json', current, 3, 3, steps)).toBe(current);
  });

  it('fails loudly when a step is missing or skips a version', () => {
    expect(() => migrateData('roster.json', {}, 1, 4, steps)).toThrowError(/no migration from schema 3 to 4/);
    expect(() => migrateData('roster.json', {}, 1, 2, [{ from: 1, to: 3, up: (value) => value }])).toThrowError(/no migration from schema 1 to 2/);
  });
});
