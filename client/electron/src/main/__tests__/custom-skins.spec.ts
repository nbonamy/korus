import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultThemeSettings, normalizeThemeSettings } from '@workspace/core/settings';
import type { CustomAppTheme } from '@workspace/core/custom-themes';
import { CustomSkinStore } from '../custom-skins';

describe('named custom skins', () => {
  const directories: string[] = [];
  afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
  const definition = { version: 1, name: 'Ocean', appearance: 'dark', colors: { canvas: '#07151f', accent: '#5ad6ce' }, css: '[data-chat-canvas]{background:#07151f}' };

  it('saves, reloads an edited active skin by name, and disables it without losing the source or palette', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'custom-skins-')); directories.push(directory);
    let theme = { ...defaultThemeSettings };
    const apply = vi.fn(async (skin: CustomAppTheme | null) => { theme = normalizeThemeSettings({ ...theme, skin }); });
    const store = new CustomSkinStore(directory, apply);
    const first = await store.set({ name: 'ocean', definition });
    expect(first).toMatchObject({ enabled: true, name: 'ocean', skin: { name: 'Ocean' } });
    expect(JSON.parse(await readFile(first.path!, 'utf8'))).toMatchObject(definition);
    const edited = { ...definition, css: '[data-chat-canvas]{background:#102030}' };
    await writeFile(first.path!, JSON.stringify(edited));
    await store.set({ name: 'ocean' });
    expect(theme.skin?.css).toBe(edited.css);
    await store.set({ name: null });
    expect(theme).toStrictEqual({ ...defaultThemeSettings, skin: null });
    await new CustomSkinStore(directory, apply).set({ name: 'ocean' });
    expect(theme.skin?.css).toBe(edited.css);
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it('lists valid saved skins by name and skips unreadable sources', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'custom-skins-')); directories.push(directory);
    const store = new CustomSkinStore(path.join(directory, 'skins'), vi.fn());
    await expect(store.list()).resolves.toStrictEqual([]);
    await store.set({ name: 'ocean', definition });
    await store.set({ name: 'moss', definition: { ...definition, name: 'Moss' } });
    await writeFile(path.join(directory, 'skins', 'broken.json'), '{');
    await writeFile(path.join(directory, 'skins', 'future.json'), JSON.stringify({ ...definition, version: 99 }));
    await writeFile(path.join(directory, 'skins', 'notes.txt'), 'not a skin');
    const skins = await store.list();
    expect(skins.map(entry => [entry.name, entry.skin.name])).toStrictEqual([['moss', 'Moss'], ['ocean', 'Ocean']]);
    expect(skins[1].skin.css).toBe(definition.css);
  });

  it('rejects invalid names, missing files and invalid definitions without changing appearance', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'custom-skins-')); directories.push(directory);
    const apply = vi.fn<(skin: CustomAppTheme | null) => Promise<void>>().mockResolvedValue(undefined);
    const store = new CustomSkinStore(directory, apply);
    await expect(store.set({ name: '../outside', definition })).rejects.toThrow('name');
    await expect(store.set({ name: 'missing' })).rejects.toThrow();
    await expect(store.set({ name: 'ocean', definition: { ...definition, version: 99 } })).rejects.toThrow('Unsupported');
    await expect(store.set({ name: null, definition })).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
    apply.mockRejectedValueOnce(new Error('Preferences unavailable'));
    await expect(store.set({ name: 'ocean', definition })).rejects.toThrow('Preferences unavailable');
    await expect(store.set({ name: 'ocean' })).resolves.toMatchObject({ enabled: true });
  });
});
