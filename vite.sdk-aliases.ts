import { fileURLToPath } from 'node:url';
import { sdkSources } from './scripts/sdk-sources.mjs';
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const selected = sdkSources(projectRoot);
export const sdkSourcesEnabled = selected.enabled;
export const sdkSourceRoot = selected.root;
export const sdkSourceAliases = selected.aliases;
export const sdkSourcePackages = ['@korus-dev/codex-sdk', '@korus-dev/multi-agent-sdk', '@korus-dev/agent-ui-sdk'];
