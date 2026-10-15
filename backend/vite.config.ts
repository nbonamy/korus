import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { chmod } from 'node:fs/promises';
import product from '../core/src/product.json';
import { sdkSourceAliases } from '../vite.sdk-aliases';

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(__dirname, '..');
  const env = {
    ...loadEnv(mode, rootDir, ''),
    ...process.env,
  };
  const useSdkSources = env.CODEX_APP_SDK_SOURCE === '1';

  return {
    plugins: [{
      name: 'daemon-launcher',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: product.daemonName,
          source: '#!/usr/bin/env node\nimport("./daemon.mjs").then(({ main }) => main()).catch((error) => { console.error(error); process.exitCode = 1; });\n',
        });
      },
      async writeBundle(options) {
        await chmod(path.resolve(options.dir ?? 'dist', product.daemonName), 0o755);
      },
    }],
    define: {
      __APP_TELEMETRY_URL__: JSON.stringify(env.APP_TELEMETRY_URL ?? ''),
      __APP_TELEMETRY_REVIEWED_ROLLOUT__: JSON.stringify(env.APP_TELEMETRY_REVIEWED_ROLLOUT === '1'),
      __APP_GITHUB_CLIENT_ID__: JSON.stringify(env.APP_GITHUB_CLIENT_ID ?? ''),
      __APP_LINEAR_CLIENT_ID__: JSON.stringify(env.APP_LINEAR_CLIENT_ID ?? ''),
    },
    resolve: {
      alias: {
        '@workspace/core': path.resolve(__dirname, '../core/src'),
        ...(useSdkSources ? sdkSourceAliases : {}),
      },
    },
    ssr: {
      noExternal: true,
    },
    build: {
      ssr: path.resolve(__dirname, 'src/daemon.ts'),
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      rollupOptions: {
        external: [/^node:/],
        output: {
          entryFileNames: 'daemon.mjs',
          format: 'es',
        },
      },
    },
  };
});
