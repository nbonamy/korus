import type { Agent, OpenInApplication, OpenInApplicationCatalog } from '@workspace/core/contracts';
import type { AppMenuItem } from './menu/app-menu';

const openInMenuPrefix = 'open-in:';

export function effectiveOpenInApplication(
  agent: Pick<Agent, 'openInApplication'>,
  catalog: OpenInApplicationCatalog,
): OpenInApplication {
  return agent.openInApplication && catalog.applications.some((application) => application.id === agent.openInApplication)
    ? agent.openInApplication
    : catalog.defaultApplication;
}

export function openInMenuItems(catalog: OpenInApplicationCatalog): AppMenuItem[] {
  return catalog.applications.map((application) => ({
    id: `${openInMenuPrefix}${application.id}`,
    type: 'action' as const,
    label: application.label,
    iconUrl: application.iconDataUrl,
  }));
}

export function openInApplicationFromMenuItem(itemId: string): OpenInApplication | null {
  if (!itemId.startsWith(openInMenuPrefix)) return null;
  const application = itemId.slice(openInMenuPrefix.length);
  return isOpenInApplication(application) ? application : null;
}

function isOpenInApplication(value: string): value is OpenInApplication {
  return value === 'vscode' ||
    value === 'finder' ||
    value === 'terminal' ||
    value === 'iterm2' ||
    value === 'ghostty' ||
    value === 'xcode' ||
    value === 'android-studio' ||
    value === 'jetbrains';
}
