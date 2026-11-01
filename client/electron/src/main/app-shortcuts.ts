import type { AppCommand } from '@workspace/core/contracts';
import { nativeShortcutCommand, shortcutAccelerator } from '@workspace/core/keyboard-shortcuts';

export const cycleTeamsAccelerator = shortcutAccelerator('nextTeam');

export type AppShortcutRegistrar = {
  isRegistered(accelerator: string): boolean;
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

export type AppShortcutInput = {
  alt?: boolean;
  code?: string;
  control?: boolean;
  key?: string;
  meta?: boolean;
  shift?: boolean;
  type?: string;
};

export function appCommandFromInput(input: AppShortcutInput): AppCommand | null {
  if (input.type !== 'keyDown') {
    return null;
  }

  return nativeShortcutCommand(input);
}

export function registerCycleTeamsShortcut(
  registrar: AppShortcutRegistrar,
  sendCommand: (command: AppCommand) => void,
): boolean {
  if (registrar.isRegistered(cycleTeamsAccelerator)) {
    return true;
  }

  return registrar.register(cycleTeamsAccelerator, () => {
    sendCommand({ type: 'cycle-teams' });
  });
}

export function unregisterCycleTeamsShortcut(registrar: AppShortcutRegistrar): void {
  if (registrar.isRegistered(cycleTeamsAccelerator)) {
    registrar.unregister(cycleTeamsAccelerator);
  }
}
