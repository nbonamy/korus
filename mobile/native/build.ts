import path from 'node:path';
import { readFileSync } from 'node:fs';
import { rolldown, type Plugin } from 'rolldown';

/** Enforce the shipped artifact boundary, including transitive dependencies; no JS crypto fallback. */
export function appleCryptoBuild(): Plugin {
  const audit: Plugin = {
    name: 'apple-only-crypto',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (module.renderedLength > 0 && /\/(?:@noble|@chainsafe\/(?:as-chacha20poly1305|as-sha256))\//.test(id.replaceAll('\\', '/'))) {
            this.error(`Non-Apple cryptography in iOS artifact: ${id}`);
          }
        }
      }
    },
  };
  return {
    name: 'apple-native-noise',
    async generateBundle(...args) {
      const metadata = JSON.parse(readFileSync(path.resolve(__dirname, '../../node_modules/@chainsafe/libp2p-noise/package.json'), 'utf8'));
      if (metadata.version !== '17.0.0') this.error('Revalidate the Apple adapter before changing the pinned Noise version.');
      const build = await rolldown({ input: path.resolve(__dirname, 'noise-session.js'), plugins: [audit] });
      try {
        const result = await build.generate({ format: 'iife' });
        for (const chunk of result.output) if (chunk.type === 'chunk') this.emitFile({ type: 'asset', fileName: 'noise-session.js', source: chunk.code });
      } finally { await build.close(); }
      type HookArgs = typeof args;
      const hook = audit.generateBundle as (this: unknown, ...params: HookArgs) => void;
      hook.apply(this, args);
    },
  };
}
