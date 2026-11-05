import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

describe('mobile public product metadata', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['ios', 'android'])('ships public repository metadata in the %s web bundle', async platform => {
    vi.stubEnv('COMPANION_PLATFORM', platform);
    vi.stubEnv('CODEX_APP_SDK_SOURCE', '0');
    const directory = await mkdtemp(path.join(__dirname, '.public-product-'));
    try {
      const entry = path.join(directory, 'entry.js');
      await writeFile(entry, "import { product } from '@workspace/core/product'; globalThis.mobileProduct = product;");
      const result = await build({ configFile: path.resolve(__dirname, '../web/vite.config.ts'), logLevel: 'silent',
        build: { write: false, outDir: path.join(directory, 'out'), minify: false, rollupOptions: { input: entry } } });
      const outputs = Array.isArray(result) ? result : [result];
      const context: { mobileProduct?: { repository: string; repositoryUrl: string } } = {};
      for (const output of outputs) if ('output' in output) for (const chunk of output.output) {
        if (chunk.type !== 'chunk') continue;
        expect(chunk.code).not.toContain('nbonamy/korus');
        runInNewContext(chunk.code, context);
      }
      expect(context.mobileProduct?.repository).toBe('Korus-Dev/korus');
      expect(context.mobileProduct?.repositoryUrl).toBe('https://github.com/Korus-Dev/korus');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
