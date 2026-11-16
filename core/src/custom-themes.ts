/** Imported T3 theme data. CSS is filtered by the renderer before it can run. */
export type CustomAppTheme = {
  id: string;
  name: string;
  appearance: 'light' | 'dark';
  colors: Record<string, string>;
  variants?: Partial<Record<'light' | 'dark', Record<string, string>>>;
  css?: string;
};

export const maxThemeFileSize = 2_000_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function colors(value: unknown): Record<string, string> {
  if (!record(value)) throw new Error('Skin colors must be an object.');
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error('The skin contains too many color roles.');
  return Object.fromEntries(entries.map(([key, color]) => {
    // Color values are data, never CSS declarations, references or resource addresses.
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || typeof color !== 'string'
      || color.length > 160 || !/^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([\da-z.,%+\-/\s]+\)|transparent|black|white)$/i.test(color)) {
      throw new Error(`Invalid skin color: ${key}.`);
    }
    return [key, color];
  }));
}

export function parseCustomTheme(value: unknown): CustomAppTheme {
  if (!record(value) || (value.version !== undefined && value.version !== 1)) throw new Error('Unsupported skin file.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('The skin needs a name.');
  if (value.appearance !== 'light' && value.appearance !== 'dark') throw new Error('The skin needs a light or dark appearance.');
  const palette = colors(value.colors ?? {});
  for (const role of ['canvas', 'accent']) {
    if (value[role] !== undefined) Object.assign(palette, colors({ [role]: value[role] }));
  }
  if (!Object.keys(palette).length) throw new Error('The skin needs colors.');
  let hash = 0;
  for (const char of value.name) hash = ((hash << 5) - hash + char.codePointAt(0)!) | 0;
  const slug = typeof value.id === 'string' && /^[a-z0-9-]{1,128}$/.test(value.id)
    ? value.id : value.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Math.abs(hash).toString(36);
  const variants: CustomAppTheme['variants'] = {};
  if (value.variants !== undefined) {
    if (!record(value.variants)) throw new Error('Skin variants must be an object.');
    for (const [mode, palette] of Object.entries(value.variants)) {
      if (mode !== 'light' && mode !== 'dark') throw new Error('Skin variants must be light or dark.');
      variants[mode] = colors(palette);
    }
  }
  if (value.css !== undefined && (typeof value.css !== 'string' || value.css.length > maxThemeFileSize)) throw new Error('Skin CSS is too large or invalid.');
  return {
    id: slug.startsWith('custom-') ? slug : `custom-${slug}`,
    name: value.name.trim(), appearance: value.appearance, colors: palette,
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(value.css ? { css: value.css as string } : {}),
  };
}

export function normalizeCustomTheme(value: unknown): CustomAppTheme | null {
  try { return parseCustomTheme(value); } catch { return null; }
}
