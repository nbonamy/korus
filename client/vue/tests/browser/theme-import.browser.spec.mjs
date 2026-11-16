import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';
import { withAnnotationFixture } from './annotation-fixture.mjs';
import { themeImportSource } from './fixtures/theme-import.mjs';
import { mockSkinCatalog, chooseSkin } from './fixtures/skin-catalog.mjs';

// Unmodified public API document: https://www.t3skins.dev/skins/nebula/skin.json
const nebula = await readFile(new URL('./fixtures/themes/nebula.json', import.meta.url));
const koi = await readFile(new URL('./fixtures/themes/pixel-koi-pond.json', import.meta.url));
const starry = await readFile(new URL('./fixtures/themes/starry-ridge.json', import.meta.url));
const nyx = await readFile(new URL('./fixtures/themes/nyx.json', import.meta.url));

test('loads Nebula, renders it after reload, and switches back to a chosen palette', async () => {
  const errors = await withAnnotationFixture(themeImportSource, async page => {
    await mockSkinCatalog(page, [{ slug: 'nebula', name: 'Nebula', body: nebula.toString() }]);
    await page.locator('.settings-appearance-panel__theme-select .el-select__wrapper').click();
    await page.getByRole('option', { name: 'Korus Dark Blue', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.settings-appearance-panel__skin-select .el-select__wrapper')).backgroundColor === 'rgb(0, 31, 55)');
    const controls = await page.evaluate(() => {
      const color = element => getComputedStyle(element).backgroundColor;
      return { track: color(document.querySelector('.el-segmented')), select: color(document.querySelector('.settings-appearance-panel__skin-select .el-select__wrapper')) };
    });
    assert.equal(controls.track, 'rgb(10, 44, 68)');
    assert.equal(controls.select, 'rgb(0, 31, 55)');
    const actions = page.getByRole('button', { name: 'Agent actions', exact: true });
    await actions.hover();
    assert.equal(await actions.evaluate(el => {
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(el).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    }), 20, 'header hover is a subtle palette tint rather than a solid raised panel');
    assert.equal(await page.getByRole('combobox', { name: 'Skin', exact: true }).count(), 1);
    await chooseSkin(page, 'Nebula');
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-nebula');
    await page.getByRole('button', { name: 'Settings menu', exact: true }).click();
    const embedded = page.locator('.settings-menu-popover .app-menu--embedded');
    await embedded.waitFor();
    assert.equal(await embedded.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'only the outer popover draws the menu border');
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    const canvas = page.locator('.agent-ui-conversation-pane');
    await canvas.waitFor();
    const skin = () => canvas.evaluate(el => {
      const context = document.createElement('canvas').getContext('2d');
      const luminance = color => {
        context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255)
          .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      const link = luminance(getComputedStyle(el.querySelector('.chat-tool-call__title-target--link')).color);
      const background = luminance(getComputedStyle(el).backgroundColor);
      return {
      clouds: getComputedStyle(el).backgroundImage.includes('radial-gradient'),
      animations: el.getAnimations().length,
      glass: getComputedStyle(document.querySelector('.chat-composer')).backdropFilter,
      bubble: getComputedStyle(document.querySelector('.chat-message--user .chat-message__stack')).backgroundColor,
      footer: getComputedStyle(document.querySelector('.agent-ui-workbench-layout__footer')).backgroundImage,
      sidebarRadius: getComputedStyle(document.querySelector('.agent-sidebar')).borderRadius,
      shelf: getComputedStyle(el.querySelector('.chat-composer-shelf__actions')).backgroundColor,
      composer: getComputedStyle(el.querySelector('.chat-composer')).backgroundColor,
      toolContrast: (Math.max(link, background) + .05) / (Math.min(link, background) + .05),
    }; });
    const before = await skin();
    assert.equal(before.clouds, true);
    assert.ok(before.animations >= 13, 'cloud positions and sizes animate');
    assert.match(before.glass, /blur\(22px\)/);
    assert.equal(before.bubble, 'rgba(255, 255, 255, 0.08)');
    assert.equal(before.footer, 'none', 'the composer footer does not hide the clouds');
    assert.equal(before.sidebarRadius, '0px', 'skins keep the shell sidebar square');
    assert.equal(before.shelf, before.composer, 'the shelf uses the composer’s skin background');
    assert.ok(before.toolContrast >= 4.5, 'tool filenames remain readable against the canvas');
    assert.equal(await canvas.evaluate(el => {
      const position = getComputedStyle(el).backgroundPosition;
      for (const animation of el.getAnimations()) animation.currentTime = Number(animation.currentTime) + 5000;
      return getComputedStyle(el).backgroundPosition !== position;
    }), true, 'the clouds actually move, including beneath scoped component styles');
    await page.reload();
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    await canvas.waitFor();
    assert.deepEqual(await skin(), before);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await canvas.evaluate(el => el.getAnimations().length), 0);
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Skin', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).getAttribute('title'), 'Remove Nebula');
    await page.locator('.settings-appearance-panel__theme-select').getByText('Custom skin', { exact: true }).waitFor();
    await page.locator('.settings-appearance-panel__theme-select .el-select__wrapper').click();
    await page.getByRole('option', { name: 'GitHub Dark', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-app-theme'), 'github-dark');
    assert.equal((await skin()).clouds, false);
    assert.equal((await skin()).animations, 0);
  });
  assert.deepEqual(errors, []);
});

test('renders Pixel-Koi Pond’s embedded SVG background', async () => {
  const errors = await withAnnotationFixture(themeImportSource, async page => {
    await mockSkinCatalog(page, [{ slug: 'pixel-koi-pond', name: 'Pixel-Koi Pond', body: koi.toString() }]);
    await chooseSkin(page, 'Pixel-Koi Pond');
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-pixel-koi-pond');
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    const scene = page.locator('.agent-ui-conversation-pane__layout');
    await scene.waitFor();
    const image = await scene.evaluate(async el => {
      const url = getComputedStyle(el).backgroundImage.match(/url\("(.*)"\)/s)?.[1];
      if (!url) return null;
      const image = new Image(); image.src = url; await image.decode();
      return { embedded: url.startsWith('data:image/svg+xml,'), decoded: image.naturalWidth > 0 && image.naturalHeight > 0 };
    });
    assert.deepEqual(image, { embedded: true, decoded: true });
    assert.equal(await page.evaluate(() => {
      const shelf = document.querySelector('.chat-composer-shelf').getBoundingClientRect();
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      return Math.round(composer.top - shelf.bottom);
    }), 0, 'the skin cannot separate the shelf from the composer');
  });
  assert.deepEqual(errors, []);
});

test('keeps Nyx menu surfaces opaque', async () => {
  const errors = await withAnnotationFixture(themeImportSource, async page => {
    await mockSkinCatalog(page, [{ slug: 'nyx', name: 'Nyx', body: nyx.toString() }]);
    await chooseSkin(page, 'Nyx');
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-nyx');
    await page.locator('.settings-appearance-panel__skin-select .el-select__wrapper').click();
    const menu = page.locator('.el-select__popper:visible');
    await menu.waitFor();
    assert.equal(await menu.evaluate(el => {
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(el).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    }), 255);
  });
  assert.deepEqual(errors, []);
});

test('reveals Starry Ridge’s document background and animated stars through the conversation', async () => {
  const errors = await withAnnotationFixture(themeImportSource, async page => {
    await mockSkinCatalog(page, [{ slug: 'starry-ridge', name: 'Starry Ridge', body: starry.toString() }]);
    await chooseSkin(page, 'Starry Ridge');
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-starry-ridge');
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    await page.locator('.chat-composer').waitFor();
    const scene = await page.evaluate(async () => {
      const root = document.documentElement;
      const url = getComputedStyle(root).backgroundImage.match(/url\("(.*)"\)/s)?.[1];
      const image = new Image(); image.src = url ?? ''; await image.decode();
      const pseudo = getComputedStyle(root, '::before');
      return {
        decoded: image.naturalWidth > 0,
        covers: ['.app-shell', '.app-shell__content', '.agent-ui-conversation-pane', '.agent-ui-conversation-pane__messages']
          .map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor),
        stars: pseudo.content,
        starPosition: pseudo.position,
        twinkles: root.getAnimations({ subtree: true }).some(animation => animation.animationName === 'sr-twinkle'),
      };
    });
    assert.equal(scene.decoded, true);
    assert.deepEqual(scene.covers, Array(4).fill('rgba(0, 0, 0, 0)'));
    assert.equal(scene.stars, '""');
    assert.equal(scene.starPosition, 'fixed');
    assert.equal(scene.twinkles, true);
  });
  assert.deepEqual(errors, []);
});

test('keeps light/dark variants, rejects invalid imports, and prevents skin CSS from loading remote resources', async () => {
  const errors = await withAnnotationFixture(themeImportSource, async page => {
    const requests = [];
    await page.route('https://example.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
    const theme = { version: 1, name: 'Safe sky', appearance: 'dark', colors: { canvas: '#101018', accent: '#cc88ee' },
      variants: { light: { canvas: '#eeeeff', accent: '#663399' } },
      css: `@import url('https://example.invalid/import');
        @font-face{font-family:attack;src:url('https://example.invalid/font')}
        [data-chat-canvas]{background-image:url('https://example.invalid/canvas');font-family:attack}
        [data-user-message-bubble]{--leak:u\\72l('https://example.invalid/escaped');background-image:var(--leak)}
        @media(min-width:1px){[data-slot="composer-host"]{background-image:image-set('https://example.invalid/set' 1x)}}`,
    };
    await mockSkinCatalog(page, [
      { slug: 'safe-sky', name: 'Safe sky', body: theme },
      { slug: 'safe-sky-two', name: 'Safe sky two', body: { ...theme, name: 'Safe sky two' } },
      { slug: 'invalid', name: 'Invalid skin', body: { ...theme, version: 99 } },
    ], { failFirst: true, pageSize: 1 });
    await page.locator('.settings-appearance-panel__skin-select .el-select__wrapper').click();
    await page.getByRole('alert').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.settings-appearance-panel__skin-select .el-select__wrapper').click();
    const preview = page.getByRole('link', { name: 'Preview Safe sky', exact: true });
    await preview.waitFor();
    assert.equal(await preview.getAttribute('href'), 'https://www.t3skins.dev/skins/safe-sky');
    await preview.click();
    assert.equal(await page.locator('html').getAttribute('data-app-theme'), 'app-light');
    await page.getByRole('option', { name: 'Safe sky', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-safe-sky');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'System mode keeps following the OS with a skin variant');
    await chooseSkin(page, 'Safe sky two');
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-safe-sky-two');
    await page.locator('.el-segmented').getByText('Light', { exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const segment = await page.evaluate(() => {
      const track = document.querySelector('.el-segmented');
      return [getComputedStyle(track).backgroundColor, getComputedStyle(track.querySelector('.el-segmented__item-selected')).backgroundColor];
    });
    assert.notEqual(segment[0], segment[1], 'the selected mode segment stands out from its track under a skin');
    await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
    const canvas = page.locator('.agent-ui-conversation-pane');
    await canvas.waitFor();
    assert.equal(await canvas.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(238, 238, 255)');
    for (const selector of ['.agent-ui-conversation-pane', '.chat-composer', '.chat-message--user .chat-message__stack']) {
      assert.equal(await page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    }
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await chooseSkin(page, 'Invalid skin');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-app-theme'), 'custom-safe-sky-two');
    assert.deepEqual(requests, []);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'app-light');
    await page.reload();
    assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 0);
    await page.locator('.settings-appearance-panel__skin-select .el-select__wrapper').click();
    assert.equal(await page.getByRole('option').first().innerText(), 'Load from file…');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('option', { name: 'Load from file…', exact: true }).click();
    await (await chooser).setFiles({ name: 'local-skin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(theme)) });
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'custom-safe-sky');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.appTheme === 'app-light');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'removing a dark skin restores the chosen light mode');
  });
  assert.deepEqual(errors, []);
});
