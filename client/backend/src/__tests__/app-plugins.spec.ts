import { describe, expect, it } from 'vitest';
import { computerUsePlugin } from '@workspace/core/app-plugins';
import { composePluginCatalog } from '../app-plugins';

const plugin = (id: string, displayName = id) => ({ id, name: id.split('@')[0]!, displayName, enabled: true });

describe('composePluginCatalog', () => {
  it("replaces a harness's own Computer Use plugins with Korus's and keeps the others in order", () => {
    const native = [plugin('gmail@remote'), plugin('computer-use@openai-bundled', 'Computer Use'), plugin('unified-computer-use@openai-bundled'), plugin('dropbox')];

    expect(composePluginCatalog(native, { computerUse: true })).toStrictEqual([plugin('gmail@remote'), plugin('dropbox'), computerUsePlugin]);
  });

  it('offers Korus Computer Use even where the harness has no plugins, and only while Computer Use is on', () => {
    expect(composePluginCatalog([], { computerUse: true })).toStrictEqual([computerUsePlugin]);
    expect(composePluginCatalog([plugin('computer-use@openai-bundled')], { computerUse: false })).toStrictEqual([]);
  });
});
