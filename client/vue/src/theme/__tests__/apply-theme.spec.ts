import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAppTheme, subscribeToSystemAppearance } from '../apply-theme';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-appearance');
  document.documentElement.removeAttribute('data-effective-appearance');
  document.documentElement.removeAttribute('data-codex-theme');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-platform');
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe('applyAppTheme', () => {
  it('keeps light theme sidebars darker than the main chat surface', () => {
    applyAppTheme({
      id: 'app-light',
      mode: 'light',
      uiFontSize: 14,
      chatFontSize: 15,
      codeFontSize: 13,
    });

    const root = document.documentElement;
    expect(root.dataset.effectiveAppearance).toBe('light');
    expect(root.style.getPropertyValue('--color-shell-main')).toBe('var(--color-surface-lowest)');
    expect(root.style.getPropertyValue('--color-shell-sidebar')).toBe('var(--color-surface-low)');
    expect(root.style.getPropertyValue('--color-shell-rail')).toBe('color-mix(in srgb, var(--color-shell-main) 92%, black)');
  });

  it('applies theme color and font tokens to the document root', () => {
    applyAppTheme({
      id: 'github-dark',
      mode: 'dark',
      uiFontSize: 14,
      chatFontSize: 16,
      codeFontSize: 12,
    });

    const root = document.documentElement;
    expect(root.dataset.appearance).toBe('dark');
    expect(root.dataset.effectiveAppearance).toBe('dark');
    expect(root.dataset.codexTheme).toBe('dark');
    expect(root.dataset.theme).toBe('github-dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.getPropertyValue('--color-surface-lowest')).toBe('#010409');
    expect(root.style.getPropertyValue('--codex-surface-color')).toBe('#010409');
    expect(root.style.getPropertyValue('--codex-text-color')).toBe('#e6edf3');
    expect(root.style.getPropertyValue('--color-text')).toBe('var(--color-on-surface)');
    expect(root.style.getPropertyValue('--color-shell-main')).toBe('var(--color-surface-low)');
    expect(root.style.getPropertyValue('--color-shell-sidebar')).toBe('var(--color-surface-lowest)');
    expect(root.style.getPropertyValue('--color-shell-rail')).toBe('color-mix(in srgb, var(--color-shell-main) 92%, black)');
    expect(root.style.getPropertyValue('--chat-font-size')).toBe('16px');
    expect(root.style.getPropertyValue('--code-font-size')).toBe('12px');
  });

  it('gives the macOS rail the sidebar translucency with a darker tint', () => {
    document.documentElement.dataset.platform = 'macos';

    applyAppTheme({
      id: 'app-light',
      mode: 'light',
      uiFontSize: 14,
      chatFontSize: 15,
      codeFontSize: 13,
    });

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-shell-sidebar')).toBe(
      'color-mix(in srgb, var(--color-shell-main) var(--shell-glass-opacity), transparent)',
    );
    expect(root.style.getPropertyValue('--color-shell-rail')).toBe(
      'color-mix(in srgb, color-mix(in srgb, var(--color-shell-main) 92%, black) var(--shell-glass-opacity), transparent)',
    );
  });

  it('applies the explicitly selected theme even when mode is system', () => {
    applyAppTheme({
      id: 'one-dark-pro',
      mode: 'system',
      uiFontSize: 14,
      chatFontSize: 15,
      codeFontSize: 13,
    });

    const root = document.documentElement;
    expect(root.dataset.appearance).toBe('system');
    expect(root.dataset.effectiveAppearance).toBe('dark');
    expect(root.dataset.theme).toBe('one-dark-pro');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.getPropertyValue('--color-surface-lowest')).toBe('#21252b');
  });

  it('resubscribes system theme changes without throwing when unavailable', () => {
    expect(subscribeToSystemAppearance()).toBeTypeOf('function');
  });

  it('reapplies system themes on appearance changes and removes the listener', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
    }));
    vi.resetModules();
    const themeModule = await import('../apply-theme');
    themeModule.applyAppTheme({
      id: 'app-light',
      mode: 'system',
      uiFontSize: 14,
      chatFontSize: 15,
      codeFontSize: 13,
    });

    const unsubscribe = themeModule.subscribeToSystemAppearance();
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    addEventListener.mock.calls[0][1]();
    unsubscribe();

    expect(removeEventListener).toHaveBeenCalledWith('change', addEventListener.mock.calls[0][1]);
  });
});
