export function claudeToolResultText(value: unknown): string {
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (isRecord(entry) && typeof entry.text === 'string') return entry.text;
      return JSON.stringify(entry);
    }).join('\n');
  }

  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
