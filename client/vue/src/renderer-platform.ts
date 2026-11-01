export type RendererPlatform = 'macos' | 'windows' | 'other';

export function rendererPlatform(navigatorPlatform: string, userAgent = ''): RendererPlatform {
  if (navigatorPlatform.startsWith('Mac') || userAgent.includes('Macintosh')) return 'macos';
  if (navigatorPlatform.startsWith('Win') || userAgent.includes('Windows')) return 'windows';
  return 'other';
}

/** Native window chrome (glass sidebars, window edges) only applies to desktop hosts, never to a browser tab. */
export function applyRendererPlatform(
  root: HTMLElement,
  navigatorPlatform: string,
  userAgent = '',
  nativeWindow = true,
): void {
  root.dataset.platform = nativeWindow ? rendererPlatform(navigatorPlatform, userAgent) : 'other';
}
