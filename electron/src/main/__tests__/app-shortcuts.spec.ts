import { describe, expect, it } from 'vitest';
import {
  appCommandFromInput,
  cycleTeamsAccelerator,
  registerCycleTeamsShortcut,
  type AppShortcutRegistrar,
} from '../app-shortcuts';

describe('appCommandFromInput', () => {
  it('maps command backtick keydown to cycle teams', () => {
    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      key: '`',
    })).toStrictEqual({ type: 'cycle-teams' });
    expect(appCommandFromInput({
      type: 'keyDown',
      meta: true,
      code: 'Backquote',
      key: 'Dead',
    })).toStrictEqual({ type: 'cycle-teams' });
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
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'w' })).toStrictEqual({ type: 'close-active-agent' });
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'w' })).toStrictEqual({ type: 'close-active-team' });
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
    expect(appCommandFromInput({ type: 'keyUp', meta: true, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, shift: true, key: 'r' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: false, key: '`' })).toBeNull();
    expect(appCommandFromInput({ type: 'keyDown', meta: true, key: 'x' })).toBeNull();
  });

  it('registers command backtick with the native shortcut registrar', () => {
    let callback: () => void = () => undefined;
    const commands: unknown[] = [];
    const registered = new Set<string>();
    const registrar: AppShortcutRegistrar = {
      isRegistered: (accelerator) => registered.has(accelerator),
      register: (accelerator, nextCallback) => {
        registered.add(accelerator);
        callback = nextCallback;
        return true;
      },
      unregister: (accelerator) => {
        registered.delete(accelerator);
      },
    };

    expect(registerCycleTeamsShortcut(registrar, (command) => commands.push(command))).toBe(true);
    expect(registered.has(cycleTeamsAccelerator)).toBe(true);

    callback();

    expect(commands).toStrictEqual([{ type: 'cycle-teams' }]);
  });
});
