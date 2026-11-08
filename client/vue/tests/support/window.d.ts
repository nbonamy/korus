import type { AppApi } from '@workspace/core/contracts';

declare global {
  interface Window {
    app?: AppApi;
  }
}

export {};
