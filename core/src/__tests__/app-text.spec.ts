import { describe, expect, it } from 'vitest';
import { appText, isAppTextDescriptor } from '../app-text';

describe('app text', () => {
  it('accepts literal strings and valid descriptors', () => {
    expect(appText('Git failed')).toBe('Git failed');
    expect(appText({ key: 'backend.connected', params: { provider: 'Codex', attempts: 2 } })).toEqual({
      key: 'backend.connected',
      params: { provider: 'Codex', attempts: 2 },
    });
  });

  it('rejects malformed descriptors', () => {
    expect(isAppTextDescriptor({ key: 'backend.connected', params: { nested: {} } })).toBe(false);
    expect(appText({ key: 42 })).toBeUndefined();
    expect(appText(null)).toBeUndefined();
  });
});
