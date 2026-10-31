import type { CodexComposerMenuItem } from '@codex-app-sdk/vue';
import { IconChecklist, IconPalette, IconSitemap } from '@tabler/icons-vue';
import { GitBranchIcon, TargetArrowIcon } from '../shared/icons/app-icons';
import { translate } from '../i18n';

export type ConversationMenuCommand = 'design' | 'visualize' | 'delegate' | 'review' | 'mission';

export function conversationCommandMenuItems(): CodexComposerMenuItem[] {
  return [
    { id: 'app-commands', type: 'separator' },
    ...([
      ['design', IconPalette], ['visualize', IconSitemap], ['delegate', GitBranchIcon], ['review', IconChecklist], ['mission', TargetArrowIcon],
    ] as const).map(([command, icon]) => ({
      id: `app-command:${command}`, type: 'action' as const,
      label: translate(`chat.composerActions.${command}`), icon,
      payload: { kind: 'app-command', command },
    })),
    { id: 'app-command-modes', type: 'separator' },
  ];
}

export function conversationMenuCommand(payload: unknown): ConversationMenuCommand | null {
  if (!payload || typeof payload !== 'object' || !('kind' in payload) || payload.kind !== 'app-command' || !('command' in payload)) return null;
  return payload.command === 'design' || payload.command === 'visualize' || payload.command === 'delegate' || payload.command === 'review' || payload.command === 'mission' ? payload.command : null;
}
