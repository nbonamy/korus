import type { AppCommand } from '@workspace/core/contracts';
import { nativeShortcutCommand } from '@workspace/core/keyboard-shortcuts';

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
