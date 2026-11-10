import type { BackendPermissionModeOption } from '@workspace/core/contracts';
import type { CodexComposerMenuItem } from 'ai-app-sdk';
import { ShieldCheckIcon } from '../shared/icons/app-icons';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';

export function conversationPermissionMenuItems(
  modes: readonly BackendPermissionModeOption[],
  selectedMode?: string | null,
): CodexComposerMenuItem[] {
  if (modes.length === 0) return [];

  return [{
    id: 'backend-permissions',
    type: 'submenu',
    label: translate('surface.appShell.permissions'),
    icon: ShieldCheckIcon,
    submenuAlignment: 'bottom',
    submenuWidth: 'wide',
    items: modes.map((mode) => permissionModeMenuItem(mode, selectedMode ?? 'default')),
  }];
}

function permissionModeMenuItem(
  mode: BackendPermissionModeOption,
  selectedMode: string | null | undefined,
): CodexComposerMenuItem {
  return {
    id: `permission-mode:${mode.id}`,
    type: 'radio',
    label: localizedText(mode.label, translate) ?? mode.id,
    description: localizedText(mode.description, translate) ?? '',
    checked: mode.id === selectedMode,
    payload: { kind: 'permission-mode', mode: mode.id },
  };
}
