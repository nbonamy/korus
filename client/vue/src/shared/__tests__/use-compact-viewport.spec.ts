import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { compactViewportQuery, useCompactViewport } from '../use-compact-viewport';

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(query));
  return {
    query,
    listeners,
    change(next: boolean) {
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe('useCompactViewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts from the current viewport and follows later size changes', () => {
    const media = stubMatchMedia(true);
    const scope = effectScope();
    const compact = scope.run(() => useCompactViewport())!;

    expect(window.matchMedia).toHaveBeenCalledWith(compactViewportQuery);
    expect(compact.value).toBe(true);

    media.change(false);
    expect(compact.value).toBe(false);
    scope.stop();
  });

  it('stops listening once its scope is disposed', () => {
    const media = stubMatchMedia(false);
    const scope = effectScope();
    scope.run(() => useCompactViewport());
    expect(media.listeners.size).toBe(1);

    scope.stop();
    expect(media.listeners.size).toBe(0);
  });

  it('stays in the desktop layout when media queries are unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(useCompactViewport().value).toBe(false);
  });
});
