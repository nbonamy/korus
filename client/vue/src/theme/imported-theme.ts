import type { CustomAppTheme } from '@workspace/core/custom-themes';
import type { AppThemeDefinition } from './themes';

/** Translate named roles, retaining independent surfaces instead of flattening the palette. */
export function importedTheme(theme: CustomAppTheme, mode = theme.appearance): AppThemeDefinition {
  const p = mode === theme.appearance ? theme.colors : theme.variants?.[mode] ?? theme.colors;
  const canvas = p.canvas ?? (mode === 'dark' ? '#18101b' : '#fcf8fc');
  const text = p.text ?? (mode === 'dark' ? '#f4edf5' : '#27212a');
  const mix = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, ${canvas})`;
  const accent = p.accent ?? '#b86bd6';
  const surface = p.surface ?? mix(accent, 6);
  const raised = p.surfaceRaised ?? mix(accent, 10);
  const muted = p.textMuted ?? p.mutedForeground ?? mix(text, 60);
  const border = p.border ?? mix(text, 16);
  const message = p.messageSurface ?? mix(accent, 16);
  return {
    id: theme.id, name: theme.name, appearance: mode, css: theme.css,
    colors: {
      // T3 secondary is a surface; Korus secondary is an interactive foreground.
      '--color-primary': accent, '--color-secondary': p.focus ?? accent,
      '--color-on-primary': p.accentForeground ?? text,
      '--color-primary-container': p.accentSurface ?? mix(accent, 18),
      '--color-on-primary-container': p.accentSurfaceForeground ?? text,
      '--color-surface': canvas, '--color-surface-lowest': canvas,
      '--color-surface-low': canvas, '--color-surface-base': surface,
      '--color-surface-high': raised, '--color-surface-highest': p.surfaceOverlay ?? raised,
      '--color-on-surface': text, '--color-on-surface-variant': muted,
      '--color-outline': border, '--color-outline-variant': border,
      '--color-shell-main': canvas, '--color-shell-sidebar': p.sidebar ?? surface,
      '--color-shell-rail': p.chrome ?? canvas, '--color-menu-background': p.surfaceOverlay ?? raised,
      '--color-dialog-body': p.surfaceOverlay ?? raised,
      '--agent-ui-shell-main-color': canvas, '--agent-ui-surface-color': canvas,
      '--agent-ui-shell-sidebar-color': message,
      '--skin-message-surface': message, '--skin-message-foreground': p.messageForeground ?? text,
      '--skin-code-background': p.codeBackground ?? surface, '--skin-code-foreground': p.codeForeground ?? text,
      '--skin-message-action': p.messageAction ?? accent,
      '--skin-message-action-foreground': p.messageActionForeground ?? text,
      '--skin-sidebar-row-selected': p.sidebarRowSelected ?? mix(accent, 20),
      '--skin-sidebar-row-hover': p.sidebarRowHover ?? mix(text, 8),
      '--skin-sidebar-foreground': p.sidebarForeground ?? text,
      '--skin-sidebar-muted-foreground': p.sidebarMutedForeground ?? muted,
      ...Object.fromEntries(Object.entries(p).map(([role, value]) => [
        `--app-theme-${role.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`, value,
      ])),
    },
  };
}
