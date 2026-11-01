import { appPlatformActions } from '../platform-api';

export function externalBrowserUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export async function openInExternalBrowser(url: string): Promise<void> {
  const target = externalBrowserUrl(url);
  if (!target || !appPlatformActions.openExternal) return;
  await appPlatformActions.openExternal(target);
}
