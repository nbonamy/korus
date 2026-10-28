import { product } from '@workspace/core/product';
import backendPackage from '../../package.json';

export const storeSchemaVersion = 1;
// Shared execution selections require a reader that understands the nested request shape.
export const rosterSchemaVersion = 3;
const storeWrittenBy = `daemon ${backendPackage.version}`;

export class StoreFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreFormatError';
  }
}

export type StoreEnvelope = {
  schemaVersion: number;
  writtenBy?: string;
  data: unknown;
};

export function serializeStoreFile(data: unknown, schemaVersion = storeSchemaVersion): string {
  return `${JSON.stringify({ schemaVersion, writtenBy: storeWrittenBy, data }, null, 2)}\n`;
}

/** Parses a store file and refuses anything this build cannot safely read or rewrite. */
export function parseStoreFile(file: string, text: string, supportedVersion = storeSchemaVersion): StoreEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StoreFormatError(`${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Restore it from the backups folder.`);
  }
  if (!isRecord(parsed) || !Number.isInteger(parsed.schemaVersion) || (parsed.schemaVersion as number) < 1 || !('data' in parsed)) {
    throw new StoreFormatError(`${file} has no valid schemaVersion and data. Restore it from the backups folder.`);
  }
  const schemaVersion = parsed.schemaVersion as number;
  const writtenBy = typeof parsed.writtenBy === 'string' ? parsed.writtenBy : undefined;
  if (schemaVersion > supportedVersion) {
    throw new StoreFormatError(`${file} uses schema ${schemaVersion}${writtenBy ? ` written by ${writtenBy}` : ''}; this build (${storeWrittenBy}) supports up to schema ${supportedVersion}. Update ${product.name}; this build will not rewrite the file.`);
  }
  return { schemaVersion, ...(writtenBy ? { writtenBy } : {}), data: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
