export function optional(record: Record<string, unknown>, key: string, validator: (value: unknown) => boolean): boolean {
  return !hasOwn(record, key) || record[key] === undefined || validator(record[key]);
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isRecordMapOf(value: unknown, validator: (value: unknown) => boolean): boolean {
  return isRecord(value) && Object.values(value).every(validator);
}

export function isArrayOf(value: unknown, validator: (value: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(validator);
}

export function includes(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): boolean {
  return typeof value === 'string';
}

export function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

export function isNumber(value: unknown): boolean {
  return typeof value === 'number';
}

export function isAgentBackend(value: unknown): boolean {
  return value === 'codex' || value === 'claude' || (value === 'antigravity' || value === 'cursor');
}

export function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

export function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

export function isNullable(value: unknown, validator: (value: unknown) => boolean): boolean {
  return value === null || validator(value);
}
