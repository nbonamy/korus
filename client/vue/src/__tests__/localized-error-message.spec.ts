import { describe, expect, it, vi } from 'vitest';
import { encodeAppErrorDescriptor } from '@workspace/core/app-error';
import { localizedErrorMessage } from '../i18n/errors';

describe('localizedErrorMessage', () => {
  it('translates structured app errors instead of displaying backend prose', () => {
    const translate = vi.fn((key: string, params?: Record<string, string | number>) => (
      `${key}:${params?.repository ?? ''}`
    ));
    const message = encodeAppErrorDescriptor({
      kind: 'appError',
      code: 'clone.discoveryFailed',
      params: { repository: 'skills' },
    }, 'backend fallback');

    expect(localizedErrorMessage(new Error(`Error invoking remote method: ${message}`), translate))
      .toBe('errors.clone.discoveryFailed:skills');
  });

  it('preserves external and diagnostic errors without descriptors', () => {
    expect(localizedErrorMessage(new Error('git failed'), vi.fn())).toBe('git failed');
  });
});
