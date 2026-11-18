import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSkinCatalog, maxCatalogPages } from '../skin-catalog';

describe('fetchSkinCatalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stops at a bounded number of pages whatever the catalog reports', async () => {
    const fetch = vi.fn(async (url: URL) => new Response(JSON.stringify({
      pageCount: 100_000,
      skins: [{ slug: `skin-${url.searchParams.get('page')}`, name: 'Skin' }],
    })));
    vi.stubGlobal('fetch', fetch);

    const skins = await fetchSkinCatalog(new AbortController().signal);

    expect(fetch).toHaveBeenCalledTimes(maxCatalogPages);
    expect(skins).toHaveLength(maxCatalogPages);
  });
});
