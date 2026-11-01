import { describe, expect, it } from 'vitest';
import { appErrorCodes } from '@workspace/core/app-error';
import { messages } from '../i18n/messages';

describe('i18n contract', () => {
  it('presents every structured app error in the renderer catalog', () => {
    for (const code of appErrorCodes) {
      expect(messageAtPath(messages.en, `errors.${code}`), code).toEqual(expect.any(String));
    }
  });

});

function messageAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => (
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), value);
}
