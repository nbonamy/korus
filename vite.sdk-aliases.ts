import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
export const sdkSourceRoot = path.resolve(projectRoot, process.env.CODEX_APP_SDK_SOURCE_ROOT || '..');

export const sdkSourceAliases = {
  'multi-agents-sdk/conversation-replica': path.join(sdkSourceRoot, 'multi-agents-sdk/src/core/conversation-replica.ts'),
  'multi-agents-sdk/surface-bridge': path.join(sdkSourceRoot, 'multi-agents-sdk/src/core/surface-bridge.ts'),
  'multi-agents-sdk/surface': path.join(sdkSourceRoot, 'multi-agents-sdk/src/core/surface.ts'),
  'multi-agents-sdk/events': path.join(sdkSourceRoot, 'multi-agents-sdk/src/core/typed-event-bus.ts'),
  'multi-agents-sdk/core': path.join(sdkSourceRoot, 'multi-agents-sdk/src/core/index.ts'),
  'multi-agents-sdk/runtime': path.join(sdkSourceRoot, 'multi-agents-sdk/src/runtime/discovery.ts'),
  'multi-agents-sdk/codex': path.join(sdkSourceRoot, 'multi-agents-sdk/src/providers/codex/index.ts'),
  'multi-agents-sdk': path.join(sdkSourceRoot, 'multi-agents-sdk/src'),
  'codex-sdk': path.join(sdkSourceRoot, 'codex-sdk/src'),
  'ai-app-sdk/browser-ui': path.join(sdkSourceRoot, 'ai-app-sdk/src/vue/browser/index.ts'),
  'ai-app-sdk/host': path.join(sdkSourceRoot, 'ai-app-sdk/src/host/contracts.ts'),
  'ai-app-sdk/electron/preload': path.join(sdkSourceRoot, 'ai-app-sdk/src/electron/preload.ts'),
  'ai-app-sdk/electron': path.join(sdkSourceRoot, 'ai-app-sdk/src/electron/index.ts'),
  'ai-app-sdk/documents': path.join(sdkSourceRoot, 'ai-app-sdk/src/documents'),
  'ai-app-sdk/browser': path.join(sdkSourceRoot, 'ai-app-sdk/src/browser'),
  'ai-app-sdk/speech': path.join(sdkSourceRoot, 'ai-app-sdk/src/speech'),
  'ai-app-sdk/styles.css': path.join(sdkSourceRoot, 'ai-app-sdk/src/vue/styles.css'),
  'ai-app-sdk': path.join(sdkSourceRoot, 'ai-app-sdk/src/vue'),
};
