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

  it('names a control the model did not label from the control the helper reports having acted on', () => {
    const args = { app: 'Safari', element_index: 120 };
    const reported = (target: Record<string, unknown>) => ({ structuredContent: { target } });

    expect(computerUseTitle('computer-use-click', args, undefined, 'running')).toBe('Clicking control #120 in Safari');
    expect(computerUseTitle('computer-use-click', args, reported({ title: 'First Name' }), 'completed')).toBe('Clicked First Name in Safari');
    expect(computerUseTitle('computer-use-type-text', args, reported({ title: '', description: 'Email address' }), 'completed')).toBe('Entered text in Email address in Safari');
    expect(computerUseTitle('computer-use-get-app-state', { ...args, rootElementIndex: 120 }, reported({ title: 'Preferred Resolution' }), 'completed')).toBe('Inspected Preferred Resolution in Safari');
    // The model's own label wins, and a very long name is cut.
    expect(computerUseTitle('computer-use-click', { ...args, label: 'Submit' }, reported({ title: 'First Name' }), 'completed')).toBe('Clicked Submit in Safari');
    expect(computerUseTitle('computer-use-click', args, reported({ title: 'x'.repeat(100) }), 'completed')).toBe(`Clicked ${'x'.repeat(39)}… in Safari`);
  });

  it.each([
    ['computer-use-find-apps', { app: 'Safari' }, undefined, 'Found installed apps matching Safari'],
    ['computer-use-find-apps', {}, undefined, 'Found installed apps'],
    ['computer-use-focus-app', { app: 'Safari' }, undefined, 'Focused Safari'],
    ['computer-use-launch-app', { path: '/Applications/Safari.app' }, undefined, 'Launched Safari'],
    ['computer-use-list-apps', {}, { apps: [{}, {}] }, 'Listed 2 open apps'],
    ['computer-use-list-apps', {}, undefined, 'Listed open apps'],
    ['computer-use-list-windows', { app: 'Safari' }, { structuredContent: { windows: [{}] } }, 'Listed 1 Safari windows'],
    ['computer-use-list-windows', { bundleIdentifier: 'com.apple.Safari' }, undefined, 'Listed com.apple.Safari windows'],
    ['computer-use-scroll', { app: 'Safari', direction: 'down' }, undefined, 'Scrolled down in Safari'],
    ['computer-use-scroll', { app: 'Safari', direction: 'down', element_index: 4 }, undefined, 'Scrolled control #4 down in Safari'],
    ['computer-use-scroll', { app: 'Safari', direction: 'up', label: 'Results' }, undefined, 'Scrolled Results up in Safari'],
    ['computer-use-screenshot', { scope: 'screen', displayId: 2 }, undefined, 'Captured display 2 screenshot'],
    ['computer-use-screenshot', { scope: 'screen' }, undefined, 'Captured main display screenshot'],
    ['computer-use-screenshot', { app: 'Safari' }, undefined, 'Captured Safari window screenshot'],
    ['computer-use-set-value', { app: 'Safari', element_index: 95 }, undefined, 'Updated control #95 in Safari'],
    ['computer-use-select-text', { app: 'Safari' }, undefined, 'Selected text in app control in Safari'],
    ['computer-use-press-key', { app: 'Safari', key: 'Return' }, undefined, 'Pressed Return in Safari'],
    ['computer-use-press-key', { app: 'Safari' }, undefined, 'Pressed Safari'],
    ['computer-use-click', { app: 'Safari', x: 10, y: 20 }, undefined, 'Clicked Safari at (10, 20)'],
    ['computer-use-click', { app: 'Safari' }, undefined, 'Clicked app control in Safari'],
    ['computer-use-drag', { app: 'Safari' }, undefined, 'Dragged in Safari'],
    ['computer-use-paste', {}, undefined, 'Pasted content in frontmost app'],
    ['computer-use-get-app-state', { app: 'Safari', rootElementIndex: 7 }, undefined, 'Inspected control #7 in Safari'],
    ['computer-use-fill-form', { app: 'Safari', fields: [] }, undefined, 'Filled Safari'],
    ['computer-use-fill-form', { app: 'Safari', fields: [{}] }, undefined, 'Filled 1 field in Safari'],
    ['computer-use-status', {}, undefined, 'Checked Computer Use permissions and availability'],
  ])('titles %s with %j as: %s', (tool, args, result, expected) => {
    expect(computerUseTitle(tool, args, result, 'completed')).toBe(expected);
  });
});
