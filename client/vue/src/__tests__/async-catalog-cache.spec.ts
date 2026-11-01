import { describe, expect, it, vi } from 'vitest';
import { AsyncCatalogCache } from '../async-catalog-cache';

describe('AsyncCatalogCache', () => {
  it('deduplicates concurrent loads and exposes the completed catalog', async () => {
    const load = vi.fn().mockResolvedValue([{ id: 'one' }]);
    const cache = new AsyncCatalogCache<string, { id: string }>((value) => ({ ...value }));

    const first = cache.load('catalog', load, load);
    const second = cache.load('catalog', load, load);
    await first.promise;

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ value: [{ id: 'one' }], status: 'loaded', error: null });
  });

  it('ignores a stale response after the backing source changes', async () => {
    let resolveFirst!: (value: Array<{ id: string }>) => void;
    const firstSource = vi.fn(() => new Promise<Array<{ id: string }>>((resolve) => { resolveFirst = resolve; }));
    const secondSource = vi.fn().mockResolvedValue([{ id: 'fresh' }]);
    const cache = new AsyncCatalogCache<string, { id: string }>();

    const first = cache.load('catalog', firstSource, firstSource);
    const second = cache.load('catalog', secondSource, secondSource);
    await second.promise;
    resolveFirst([{ id: 'stale' }]);
    await first.promise;

    expect(cache.entry('catalog')).toMatchObject({ value: [{ id: 'fresh' }], status: 'loaded' });
  });

  it('records load errors and lets pushed catalog updates replace them', async () => {
    const cache = new AsyncCatalogCache<string, { id: string }>();
    const entry = cache.load('catalog', 'source', () => Promise.reject(new Error('offline')));
    await entry.promise;

    expect(entry).toMatchObject({ value: [], status: 'error', error: 'offline' });
    expect(cache.replace('catalog', [{ id: 'pushed' }])).toMatchObject({
      value: [{ id: 'pushed' }],
      status: 'loaded',
      error: null,
    });
  });
});
