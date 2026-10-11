import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sdkSourceRoot = process.env.CODEX_APP_SDK_SOURCE_ROOT
  ? path.resolve(process.env.CODEX_APP_SDK_SOURCE_ROOT)
  : fileURLToPath(new URL('../codex-app-sdk', import.meta.url));

export const sdkSourceAliases = {
  '@codex-app-sdk/backend/protocol': path.join(sdkSourceRoot, 'packages/backend/src/codex/index.ts'),
  '@codex-app-sdk/backend': path.join(sdkSourceRoot, 'packages/backend/src/index.ts'),
  '@codex-app-sdk/core/events': path.join(sdkSourceRoot, 'packages/core/src/typed-event-bus.ts'),
  '@codex-app-sdk/core/native': path.join(sdkSourceRoot, 'packages/core/src/native.ts'),
  '@codex-app-sdk/core/conversation-replica': path.join(sdkSourceRoot, 'packages/core/src/conversation-replica.ts'),
  '@codex-app-sdk/core/surface-bridge': path.join(sdkSourceRoot, 'packages/core/src/surface-bridge.ts'),
  '@codex-app-sdk/core/surface': path.join(sdkSourceRoot, 'packages/core/src/surface.ts'),
  '@codex-app-sdk/core': path.join(sdkSourceRoot, 'packages/core/src/index.ts'),
  '@codex-app-sdk/electron/preload': path.join(sdkSourceRoot, 'packages/electron/src/preload.ts'),
  '@codex-app-sdk/electron': path.join(sdkSourceRoot, 'packages/electron/src/index.ts'),
  '@codex-app-sdk/vue/styles.css': path.join(sdkSourceRoot, 'packages/vue/src/styles.css'),
  '@codex-app-sdk/vue': path.join(sdkSourceRoot, 'packages/vue/src/index.ts'),
};
