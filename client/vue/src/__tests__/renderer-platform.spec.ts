import { describe, expect, it } from 'vitest';
import { applyRendererPlatform, rendererPlatform } from '../renderer-platform';
import '../styles/base.css';

describe('renderer platform', () => {
  it('detects macOS navigator platform values', () => {
    expect(rendererPlatform('MacIntel')).toBe('macos');
    expect(rendererPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('macos');
    expect(rendererPlatform('Win32')).toBe('windows');
    expect(rendererPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(rendererPlatform('Linux x86_64')).toBe('other');
  });

  it('marks the document root for platform-specific shell composition', () => {
    const root = document.createElement('html');

    applyRendererPlatform(root, 'MacIntel');

    expect(root.dataset.platform).toBe('macos');
  });

  it('keeps native window chrome off browser-hosted clients', () => {
    const root = document.createElement('html');

    applyRendererPlatform(root, 'MacIntel', 'Macintosh', false);

    expect(root.dataset.platform).toBe('other');
  });

  it('draws an inset window edge only on Windows without taking layout space', () => {
    const app = document.createElement('div');
    app.className = 'window-edge';
    document.body.append(app);
    try {
      applyRendererPlatform(document.documentElement, 'Win32');
      expect(getComputedStyle(app).borderWidth).toBe('1px');
      expect(getComputedStyle(app).borderStyle).toBe('solid');
      expect(getComputedStyle(app).position).toBe('fixed');
      expect(getComputedStyle(app).pointerEvents).toBe('none');
      expect(getComputedStyle(app).display).toBe('block');
      applyRendererPlatform(document.documentElement, 'MacIntel');
      expect(getComputedStyle(app).display).toBe('none');
      applyRendererPlatform(document.documentElement, 'Linux x86_64');
      expect(getComputedStyle(app).display).toBe('none');
    } finally {
      app.remove();
      document.documentElement.removeAttribute('data-platform');
    }
  });
});
