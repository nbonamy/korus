import { product } from '@workspace/core/product';

import { translate } from '../i18n';
import { appMessageBox } from '../shared/dialog/message-box';
import type { Team } from '@workspace/core/contracts';

export async function confirmCloseTeam(team: Team): Promise<'close' | null> {
  try {
    await appMessageBox.confirm(
      `Agents, missions and quick chats will be removed from ${product.name}. Mission worktrees will not be deleted.`,
      `Close ${team.name}?`,
      {
        cancelButtonText: translate('common.cancel'),
        confirmButtonText: translate('surface.team-close-confirmation.closeTeam'),
        type: 'warning',
      },
    );
    return 'close';
  } catch {
    // Element Plus rejects when the user cancels or closes the confirmation.
    return null;
  }
}
