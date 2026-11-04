import { describe, expect, it } from 'vitest';
import { appCommandFromInput } from '../app-shortcuts';

describe('appCommandFromInput', () => {
  it('maps control backtick to cycle teams, and with shift to cycle them back', () => {
    expect(appCommandFromInput({ type: 'keyDown', control: true, key: '`' })).toStrictEqual({ type: 'cycle-teams', direction: 1 });
    expect(appCommandFromInput({ type: 'keyDown', control: true, code: 'Backquote', key: 'Dead' })).toStrictEqual({ type: 'cycle-teams', direction: 1 });
    expect(appCommandFromInput({ type: 'keyDown', control: true, shift: true, key: '~', code: 'Backquote' })).toStrictEqual({ type: 'cycle-teams', direction: -1 });
  });

  it('leaves command backtick to the system and the Window menu, which cycle windows', () => {
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: '~', code: 'Backquote' })).toBeNull();
  });

  it('maps command g and b to workspace tabs without restarting an agent on command r', () => {
    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      key: 'g',
    })).toStrictEqual({ type: 'open-review' });

    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      key: 'G',
    })).toStrictEqual({ type: 'open-review' });

    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      key: 'b',
    })).toStrictEqual({ type: 'open-browser' });

    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      key: 'r',
    })).toBeNull();
  });

  it('maps file and edit menu command shortcuts', () => {
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'n' })).toStrictEqual({ type: 'new-team' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 't' })).toBeNull();
    // Close is the window's, handled by the menu; closing an agent deletes it, so it needs Shift.
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'w' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'w' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'D' })).toStrictEqual({ type: 'close-active-agent' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'm' })).toStrictEqual({ type: 'toggle-spoken-announcements-muted' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'q' })).toStrictEqual({ type: 'quit' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'e' })).toStrictEqual({ type: 'edit-active-agent' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'd' })).toStrictEqual({ type: 'duplicate-active-agent' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: ',' })).toStrictEqual({ type: 'open-settings' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'k' })).toStrictEqual({ type: 'open-agent-palette' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'K' })).toStrictEqual({ type: 'compact-active-session' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'X' })).toStrictEqual({ type: 'save-active-prompt-draft' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'V' })).toStrictEqual({ type: 'open-saved-prompt-drafts' });
  });

  it('maps control tab to cycle agents', () => {
    expect(appCommandFromInput({
      type: 'keyDown',
      control: true,
      key: 'Tab',
    })).toStrictEqual({ type: 'cycle-agents', direction: 1 });

    expect(appCommandFromInput({
      type: 'keyDown',
      control: true,
      key: 'Tab',
      shift: true,
    })).toStrictEqual({ type: 'cycle-agents', direction: -1 });
  });

  it('ignores non-matching shortcut input', () => {
    expect(appCommandFromInput({ type: 'keyUp', control: true, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'r' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: false, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'x' })).toBeNull();
  });
});
