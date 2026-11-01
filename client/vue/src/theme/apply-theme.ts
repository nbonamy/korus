import type { AppThemeSettings } from '@workspace/core/contracts';
import { effectiveTheme } from './themes';

const mediaQuery = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

let currentSettings: AppThemeSettings | null = null;

export function applyAppTheme(settings: AppThemeSettings): void {
  currentSettings = settings;
  const root = document.documentElement;
  const theme = effectiveTheme(settings, mediaQuery?.matches ?? false);

  root.dataset.appearance = settings.mode;
  root.dataset.codexTheme = theme.appearance;
  root.dataset.effectiveAppearance = theme.appearance;
  root.dataset.theme = theme.id;
  root.classList.toggle('dark', theme.appearance === 'dark');
  root.style.colorScheme = theme.appearance;
  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(token, value);
  }
  root.style.setProperty('--color-background', 'var(--color-surface)');
  root.style.setProperty('--color-text', 'var(--color-on-surface)');
  root.style.setProperty('--color-text-muted', 'var(--color-on-surface-variant)');
  root.style.setProperty('--color-border', 'var(--color-outline-variant)');
  root.style.setProperty('--color-border-strong', 'var(--color-outline)');
  root.style.setProperty(
    '--color-shell-main',
    theme.appearance === 'dark' ? 'var(--color-surface-low)' : 'var(--color-surface-lowest)',
  );
  const nativeMacOSSidebar = root.dataset.platform === 'macos';
  root.style.setProperty('--color-shell-sidebar', nativeMacOSSidebar
    ? 'color-mix(in srgb, var(--color-shell-main) var(--shell-glass-opacity), transparent)'
    : theme.appearance === 'dark' ? 'var(--color-surface-lowest)' : 'var(--color-surface-low)');
  const railTint = 'color-mix(in srgb, var(--color-shell-main) 92%, black)';
  root.style.setProperty('--color-shell-rail', nativeMacOSSidebar
    ? `color-mix(in srgb, ${railTint} var(--shell-glass-opacity), transparent)`
    : railTint);
  root.style.setProperty('--app-ui-font-size', `${settings.uiFontSize}px`);
  root.style.setProperty('--chat-font-size', `${settings.chatFontSize}px`);
  root.style.setProperty('--code-font-size', `${settings.codeFontSize}px`);
  applyCodexThemeTokens(root, theme.colors, theme.appearance);
}

function applyCodexThemeTokens(
  root: HTMLElement,
  colors: Record<string, string>,
  appearance: 'dark' | 'light',
): void {
  const shellMain = appearance === 'dark'
    ? colors['--color-surface-low']
    : colors['--color-surface-lowest'];
  const tokens: Record<string, string | undefined> = {
    '--app-surface-color': colors['--color-surface'],
    '--codex-background-color': colors['--color-surface'],
    '--codex-border-color': colors['--color-outline-variant'],
    '--codex-hover-color': colors['--color-surface-low'],
    '--codex-muted-text-color': colors['--color-on-surface-variant'],
    '--codex-primary-color': colors['--color-primary'],
    '--codex-secondary-color': colors['--color-secondary'],
    '--codex-shell-main-color': shellMain,
    '--codex-strong-border-color': colors['--color-outline'],
    '--codex-surface-color': colors['--color-surface-lowest'],
    '--codex-surface-high-color': colors['--color-surface-high'],
    '--codex-surface-highest-color': colors['--color-surface-highest'],
    '--codex-surface-raised-color': colors['--color-surface-base'],
    '--codex-text-color': colors['--color-on-surface'],
  };

  for (const [token, value] of Object.entries(tokens)) {
    if (value) root.style.setProperty(token, value);
  }
}

export function subscribeToSystemAppearance(): () => void {
  if (!mediaQuery) {
    return () => undefined;
  }

  const listener = () => {
    if (currentSettings?.mode === 'system') {
      applyAppTheme(currentSettings);
    }
  };
  mediaQuery.addEventListener('change', listener);

  return () => {
    mediaQuery.removeEventListener('change', listener);
  };
}
