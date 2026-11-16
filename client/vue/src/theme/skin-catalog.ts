import { maxThemeFileSize, parseCustomTheme } from '@workspace/core/custom-themes';

export const skinGalleryUrl = 'https://www.t3skins.dev';
export type CatalogSkin = { slug: string; name: string };
/** The catalog's page count is remote data; never follow it without a bound. */
export const maxCatalogPages = 20;

async function readJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error(`Skin request failed (${response.status}).`);
  if (Number(response.headers.get('content-length')) > maxThemeFileSize) throw new Error('Skin response is too large.');
  const text = await response.text();
  if (text.length > maxThemeFileSize) throw new Error('Skin response is too large.');
  return JSON.parse(text);
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export async function fetchSkinCatalog(signal: AbortSignal): Promise<CatalogSkin[]> {
  const skins = new Map<string, CatalogSkin>();
  for (let page = 1, pageCount = 1; page <= pageCount; page++) {
    const url = new URL('/api/skins', skinGalleryUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('perPage', '50');
    const value = await readJson(url, signal);
    if (!record(value) || !Array.isArray(value.skins) || !Number.isInteger(value.pageCount)) throw new Error('Invalid skin catalog.');
    pageCount = Math.min(maxCatalogPages, Math.max(1, value.pageCount as number));
    for (const entry of value.skins) {
      if (record(entry) && typeof entry.slug === 'string' && /^[a-z0-9-]{1,128}$/.test(entry.slug) && typeof entry.name === 'string') {
        skins.set(entry.slug, { slug: entry.slug, name: entry.name });
      }
    }
  }
  return [...skins.values()];
}

export async function fetchCatalogSkin(slug: string, signal: AbortSignal) {
  if (!/^[a-z0-9-]{1,128}$/.test(slug)) throw new Error('Invalid skin.');
  const skin = parseCustomTheme(await readJson(new URL(`/skins/${slug}/skin.json`, skinGalleryUrl), signal));
  for (const palette of [skin.colors, ...Object.values(skin.variants ?? {})]) {
    if (Object.values(palette).some(color => !CSS.supports('color', color))) throw new Error('Invalid skin colors.');
  }
  return skin;
}
