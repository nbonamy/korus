export async function mockSkinCatalog(page, skins, { failFirst = false, pageSize = 12 } = {}) {
  let failed = false;
  await page.route('https://www.t3skins.dev/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/skins') {
      if (failFirst && !failed) { failed = true; await route.fulfill({ status: 503, body: 'Unavailable' }); return; }
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const matches = skins.filter(skin => skin.name.toLowerCase().includes(query));
      const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      const page = Math.min(pageCount, Number(url.searchParams.get('page')) || 1);
      await route.fulfill({ json: { page, perPage: pageSize, total: matches.length, pageCount,
        skins: matches.slice((page - 1) * pageSize, page * pageSize).map(skin => ({ slug: skin.slug, name: skin.name, authorName: 'Community',
          description: '', appearance: skin.appearance ?? 'dark', modes: ['dark'], canvas: '#0b060d', accent: '#d1458f' })) } });
    } else {
      const skin = skins.find(skin => url.pathname === `/skins/${skin.slug}/skin.json`);
      await route.fulfill(skin ? { contentType: 'application/json', body: typeof skin.body === 'string' ? skin.body : JSON.stringify(skin.body) }
        : { status: 404, body: 'Not found' });
    }
  });
}

export async function chooseSkin(page, name) {
  await page.locator('.settings-appearance-panel__skin-select .el-select__wrapper').click();
  await page.getByRole('option', { name, exact: true }).click();
}
