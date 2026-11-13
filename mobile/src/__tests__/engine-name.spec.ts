import { describe, expect, it } from 'vitest';
import { engineName } from '../engine-name';

describe('engine names', () => {
  it('names the engines the way people say them', () => {
    expect(['codex', 'claude', 'antigravity', 'cursor'].map(engineName)).toStrictEqual(['Codex', 'Claude', 'Antigravity', 'Cursor']);
  });
  it('capitalizes an engine this app has not met', () => {
    expect(engineName('windsurf')).toBe('Windsurf');
  });
});
