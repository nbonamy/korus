import { fileURLToPath } from 'node:url';
import { sdkSources } from './scripts/sdk-sources.mjs';
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const selected = sdkSources(projectRoot);
export const sdkSourcesEnabled = selected.enabled;
export const sdkSourceRoot = selected.root;
export const sdkSourceAliases = selected.aliases;
export const sdkSourcePackages = ['@korus-dev/codex-sdk', '@korus-dev/multi-agent-sdk', '@korus-dev/agent-ui-sdk'];

/** Browser fixtures use the same selected SDK sources as the desktop dev server. */
export const sdkSourcePlugin = {
  name: 'workspace-sdk-sources',
  config(config: { optimizeDeps?: { include?: string[] } }) {
    if (!sdkSourcesEnabled) return {};
    if (config.optimizeDeps?.include) {
      config.optimizeDeps.include = config.optimizeDeps.include.filter(dependency =>
        !sdkSourcePackages.some(name => dependency === name || dependency.startsWith(`${name}/`)));
    }
    return {
      resolve: { alias: sdkSourceAliases, dedupe: ['vue', 'element-plus', 'fix-webm-duration', 'katex', 'marked-katex-extension', 'parse-git-diff', 'elkjs'] },
      server: { fs: { allow: [projectRoot, sdkSourceRoot] } },
      optimizeDeps: {
        exclude: sdkSourcePackages,
        include: ['fix-webm-duration'],
      },
    };
  },
};
