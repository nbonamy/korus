import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import { appThemes, effectiveTheme, themeById, themeIdForAppearance } from '../themes';
import { defaultThemeSettings } from '@workspace/core/settings';

const requestedThemePairs = [
  ['absolutely-light', 'absolutely-dark'],
  ['cappuccin-latte', 'cappuccin-mocha'],
  ['everforest-light', 'everforest-dark'],
  ['github-light', 'github-dark'],
  ['gruvbox-light', 'gruvbox-dark'],
  ['linear-light', 'linear-dark'],
  ['notion-light', 'notion-dark'],
  ['one-light', 'one-dark-pro'],
  ['raycast-light', 'raycast-dark'],
  ['rose-pine-dawn', 'rose-pine-moon'],
  ['solarized-light', 'solarized-dark'],
  ['vercel-light', 'vercel-dark'],
  ['vscode-plus-light', 'vscode-plus-dark'],
  ['xcode-light', 'xcode-dark'],
];

const requestedCodexDarkThemes = [
  ['absolutely-dark', 'Absolutely Dark'],
  ['ayu-dark', 'Ayu Dark'],
  ['cappuccin-mocha', 'Cappuccin Mocha'],
  ['dracula-dark', 'Dracula Dark'],
  ['everforest-dark', 'Everforest Dark'],
  ['github-dark', 'GitHub Dark'],
  ['gruvbox-dark', 'Gruvbox Dark'],
  ['linear-dark', 'Linear Dark'],
  ['lobster-dark', 'Lobster Dark'],
  ['material-dark', 'Material Dark'],
  ['matrix-dark', 'Matrix Dark'],
  ['monokai-dark', 'Monokai Dark'],
  ['night-owl-dark', 'Night Owl'],
  ['nord-dark', 'Nord Dark'],
  ['notion-dark', 'Notion Dark'],
  ['one-dark-pro', 'One Dark'],
  ['oscurange-dark', 'Oscurange Dark'],
  ['raycast-dark', 'Raycast Dark'],
  ['rose-pine-moon', 'Rose Pine Moon'],
  ['sentry-dark', 'Sentry'],
  ['solarized-dark', 'Solarized Dark'],
  ['temple-dark', 'Temple Dark'],
  ['tokyo-night-dark', 'Tokyo Night'],
  ['vercel-dark', 'Vercel Dark'],
  ['vscode-plus-dark', 'VS Code Plus Dark'],
  ['xcode-dark', 'Xcode Dark'],
];

describe('appThemes', () => {
  it('sorts themes alphabetically by display name', () => {
    expect(appThemes.map((theme) => theme.name)).toStrictEqual(
      [...appThemes].map((theme) => theme.name).sort((left, right) => left.localeCompare(right)),
    );
  });

  it(`includes ${product.name} light, dark, and dark blue themes`, () => {
    expect(themeById('app-light')).toMatchObject({
      name: `${product.name} Light`,
      appearance: 'light',
    });
    expect(themeById('app-dark')).toMatchObject({
      name: `${product.name} Dark`,
      appearance: 'dark',
    });
    expect(themeById('app-dark-blue')).toMatchObject({
      name: `${product.name} Dark Blue`,
      appearance: 'dark',
    });
  });

  it('includes light and dark variants for each requested researched theme family', () => {
    for (const [lightId, darkId] of requestedThemePairs) {
      expect(themeById(lightId).id).toBe(lightId);
      expect(themeById(lightId).appearance).toBe('light');
      expect(themeById(darkId).id).toBe(darkId);
      expect(themeById(darkId).appearance).toBe('dark');
    }
  });

  it('includes the full requested Codex dark theme list', () => {
    for (const [themeId, name] of requestedCodexDarkThemes) {
      expect(themeById(themeId)).toMatchObject({
        id: themeId,
        name,
        appearance: 'dark',
      });
    }
  });

  it('includes the source-backed standalone Proof theme', () => {
    expect(themeById('proof-light')).toMatchObject({
      name: 'Proof',
      appearance: 'light',
    });
  });

  it(`uses ${product.name} Light as the default and pairs it with ${product.name} Dark for system mode`, () => {
    expect(defaultThemeSettings.id).toBe('app-light');
    expect(effectiveTheme(defaultThemeSettings, false).id).toBe('app-light');
    expect(effectiveTheme(defaultThemeSettings, true).id).toBe('app-dark');
    expect(themeIdForAppearance('app-light', 'light')).toBe('app-light');
    expect(themeIdForAppearance('app-light', 'dark')).toBe('app-dark');
    expect(themeIdForAppearance('app-dark-blue', 'light')).toBe('app-light');
  });

  it(`uses Witsy-derived colors for the ${product.name} themes`, () => {
    expect(themeById('app-light').colors).toMatchObject({
      '--color-surface': '#FAFAFA',
      '--color-surface-low': '#F4F4F5',
      '--color-surface-high': '#E9E9EC',
      '--color-primary': '#1B4FB2',
    });
    expect(themeById('app-dark').colors).toMatchObject({
      '--color-surface': '#202020',
      '--color-surface-low': '#303030',
      '--color-surface-high': '#404040',
      '--color-primary': 'rgb(11, 132, 255)',
    });
    expect(themeById('app-dark-blue').colors).toMatchObject({
      '--color-surface': 'rgb(0, 31, 55)',
      '--color-surface-low': 'rgb(10, 44, 68)',
      '--color-surface-high': 'rgb(40, 50, 65)',
      '--color-primary': 'rgb(10, 120, 240)',
    });
  });

  it('uses source-backed colors for researched theme families', () => {
    expect(themeById('absolutely-light').colors).toMatchObject({
      '--color-primary': '#cc7d5e',
      '--color-surface-lowest': '#f9f9f7',
      '--color-on-surface': '#2d2d2b',
    });
    expect(themeById('cappuccin-mocha').colors).toMatchObject({
      '--color-primary': '#89b4fa',
      '--color-surface-lowest': '#11111b',
      '--color-on-surface': '#cdd6f4',
    });
    expect(themeById('vercel-dark').colors).toMatchObject({
      '--color-surface-low': '#1a1a1a',
      '--color-on-surface': '#ededed',
      '--color-secondary': '#50a8ff',
    });
    expect(themeById('xcode-dark').colors).toMatchObject({
      '--color-primary': '#3c93fd',
      '--color-surface': '#292a30',
      '--color-surface-lowest': '#1c1d20',
    });
  });

  it('falls back to the default theme for unknown theme ids', () => {
    expect(themeById('missing-theme').id).toBe('app-light');
  });
});
