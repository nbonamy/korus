import { describe, expect, it } from 'vitest';
import { computerUseTitle } from '../computer-use-title';

describe('computerUseTitle', () => {
  it('names the control the model labelled, in the app it acted on', () => {
    const args = { app: 'Safari', element_index: 674, label: 'First Name' };

    expect(computerUseTitle('computer-use-click', args, undefined, 'running')).toBe('Clicking First Name in Safari');
    expect(computerUseTitle('computer-use-click', args, undefined, 'completed')).toBe('Clicked First Name in Safari');
    expect(computerUseTitle('computer-use-click', { app: 'Safari', element_index: 674 }, undefined, 'failed')).toBe('Failed clicking control #674 in Safari');
  });

  it('counts the fields of a form fill and takes the app name from the result when only a pid was given', () => {
    const args = { pid: 91940, fields: [{ element_index: 3 }, { element_index: 4 }] };

    expect(computerUseTitle('computer-use-fill-form', args, { structuredContent: { app: { localizedName: 'Safari' } } }, 'completed')).toBe('Filled 2 fields in Safari');
    expect(computerUseTitle('computer-use-fill-form', args, undefined, 'running')).toBe('Filling 2 fields in target app');
  });

  it('names the control an inspection started from', () => {
    expect(computerUseTitle('computer-use-get-app-state', { app: 'Safari', rootElementIndex: 58, label: 'Full Name' }, undefined, 'completed')).toBe('Inspected Full Name in Safari');
    expect(computerUseTitle('computer-use-get-app-state', { app: 'Safari', rootElementIndex: 58 }, undefined, 'completed')).toBe('Inspected control #58 in Safari');
  });
});
