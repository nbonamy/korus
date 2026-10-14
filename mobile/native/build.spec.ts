import { describe, expect, it } from 'vitest';
import { rolldown } from 'rolldown';
import { appleCryptoBuild } from './build';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

describe('iOS crypto artifact boundary', () => {
  it('rejects bundled third-party cryptography even when introduced through another module', async () => {
    const directory = await mkdtemp(path.join(__dirname, '.audit-'));
    try {
      const entry = path.join(directory, 'entry.js');
      await writeFile(entry, "import { sha256 } from '@noble/hashes/sha2.js'; globalThis.hash = sha256(new Uint8Array([1]));");
      const build = await rolldown({ input: entry, plugins: [appleCryptoBuild()] });
      try { await expect(build.generate({ format: 'iife' })).rejects.toThrow('Non-Apple cryptography'); }
      finally { await build.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
