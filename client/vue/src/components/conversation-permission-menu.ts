import type { ProviderPermissionModeOption } from '@workspace/core/contracts';
import type { ComposerMenuItem } from '@korus-dev/agent-ui-sdk';
import { ShieldCheckIcon } from '../shared/icons/app-icons';
import { translate } from '../i18n';
import { localizedText } from '../i18n/errors';

export function conversationPermissionMenuItems(
  modes: readonly ProviderPermissionModeOption[],
  selectedMode?: string | null,
): ComposerMenuItem[] {
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
  mode: ProviderPermissionModeOption,
  selectedMode: string | null | undefined,
): ComposerMenuItem {
  return {
    id: `permission-mode:${mode.id}`,
    type: 'radio',
    label: localizedText(mode.label, translate) ?? mode.id,
    description: localizedText(mode.description, translate) ?? '',
    checked: mode.id === selectedMode,
    payload: { kind: 'permission-mode', mode: mode.id },
  };
}
